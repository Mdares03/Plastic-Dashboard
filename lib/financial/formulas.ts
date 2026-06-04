export const FINANCIAL_FORMULA_VARIABLES = [
  "machineCostPerMin",
  "operatorCostPerMin",
  "ratedRunningKw",
  "idleKw",
  "kwhRate",
  "energyMultiplier",
  "energyCostPerMin",
  "scrapCostPerUnit",
  "rawMaterialCostPerUnit",
  "durationMin",
  "scrapUnits",
] as const;

export type FinancialFormulaVariable = (typeof FINANCIAL_FORMULA_VARIABLES)[number];

export const FINANCIAL_FORMULA_DEFAULTS = {
  downtimeTotalCost: "durationMin * (machineCostPerMin + operatorCostPerMin + energyCostPerMin)",
  slowCycleTotalCost: "durationMin * (machineCostPerMin + operatorCostPerMin + energyCostPerMin)",
  scrapTotalCost: "scrapUnits * (scrapCostPerUnit + rawMaterialCostPerUnit)",
} as const;

export type FinancialFormulaKey = keyof typeof FINANCIAL_FORMULA_DEFAULTS;

export const FINANCIAL_FORMULA_KEYS = Object.keys(FINANCIAL_FORMULA_DEFAULTS) as FinancialFormulaKey[];

export const FINANCIAL_FORMULA_LABELS: Record<FinancialFormulaKey, string> = {
  downtimeTotalCost: "Costo total por downtime",
  slowCycleTotalCost: "Costo total por ciclo lento",
  scrapTotalCost: "Costo total por scrap",
};

type BinaryOp = "+" | "-" | "*" | "/" | "^";
type UnaryOp = "+" | "-";

type ExprNode =
  | { type: "number"; value: number }
  | { type: "identifier"; name: string }
  | { type: "unary"; op: UnaryOp; expr: ExprNode }
  | { type: "binary"; op: BinaryOp; left: ExprNode; right: ExprNode };

export type CompiledFinancialExpression = {
  source: string;
  ast: ExprNode;
};

class ParseError extends Error {
  constructor(message: string, readonly index: number) {
    super(message);
    this.name = "ParseError";
  }
}

class Parser {
  private i = 0;

  constructor(
    private readonly source: string,
    private readonly allowedIdentifiers: Set<string>
  ) {}

  parse() {
    this.skipWs();
    const expr = this.parseExpression();
    this.skipWs();
    if (!this.isEof()) {
      throw new ParseError(`Token inesperado: \"${this.peek()}\"`, this.i);
    }
    return expr;
  }

  private parseExpression(): ExprNode {
    let left = this.parseTerm();
    while (true) {
      this.skipWs();
      const ch = this.peek();
      if (ch !== "+" && ch !== "-") break;
      this.i += 1;
      const right = this.parseTerm();
      left = { type: "binary", op: ch, left, right };
    }
    return left;
  }

  private parseTerm(): ExprNode {
    let left = this.parsePower();
    while (true) {
      this.skipWs();
      const ch = this.peek();
      if (ch !== "*" && ch !== "/") break;
      this.i += 1;
      const right = this.parsePower();
      left = { type: "binary", op: ch, left, right };
    }
    return left;
  }

  private parsePower(): ExprNode {
    let left = this.parseUnary();
    this.skipWs();
    if (this.peek() === "^") {
      this.i += 1;
      const right = this.parsePower();
      left = { type: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    this.skipWs();
    const ch = this.peek();
    if (ch === "+" || ch === "-") {
      this.i += 1;
      return { type: "unary", op: ch, expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    this.skipWs();
    const ch = this.peek();
    if (!ch) throw new ParseError("Expresión incompleta", this.i);

    if (ch === "(") {
      this.i += 1;
      const inner = this.parseExpression();
      this.skipWs();
      if (this.peek() !== ")") {
        throw new ParseError("Falta paréntesis de cierre", this.i);
      }
      this.i += 1;
      return inner;
    }

    if (this.isDigit(ch) || ch === ".") {
      const number = this.readNumber();
      if (number == null) throw new ParseError("Número inválido", this.i);
      return { type: "number", value: number };
    }

    if (this.isIdStart(ch)) {
      const ident = this.readIdentifier();
      if (!this.allowedIdentifiers.has(ident)) {
        throw new ParseError(`Identificador no permitido: ${ident}`, this.i - ident.length);
      }
      return { type: "identifier", name: ident };
    }

    throw new ParseError(`Token inesperado: \"${ch}\"`, this.i);
  }

  private readNumber() {
    const rest = this.source.slice(this.i);
    const match = /^(?:\d+\.?\d*|\.\d+)/.exec(rest);
    if (!match) return null;
    this.i += match[0].length;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
  }

  private readIdentifier() {
    const rest = this.source.slice(this.i);
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!match) throw new ParseError("Identificador inválido", this.i);
    this.i += match[0].length;
    return match[0];
  }

  private isEof() {
    return this.i >= this.source.length;
  }

  private peek() {
    return this.source[this.i] ?? "";
  }

  private skipWs() {
    while (!this.isEof() && /\s/.test(this.source[this.i])) this.i += 1;
  }

  private isDigit(ch: string) {
    return ch >= "0" && ch <= "9";
  }

  private isIdStart(ch: string) {
    return /[A-Za-z_]/.test(ch);
  }
}

export function compileFinancialExpression(
  expression: string,
  options?: { allowedIdentifiers?: readonly string[] }
): CompiledFinancialExpression {
  const source = String(expression ?? "").trim();
  if (!source) {
    throw new Error("La fórmula no puede estar vacía");
  }

  const allowed = new Set(options?.allowedIdentifiers ?? FINANCIAL_FORMULA_VARIABLES);
  try {
    const parser = new Parser(source, allowed);
    const ast = parser.parse();
    return { source, ast };
  } catch (err) {
    if (err instanceof ParseError) {
      throw new Error(`${err.message} (posición ${err.index + 1})`);
    }
    throw err;
  }
}

export function evaluateCompiledFinancialExpression(
  compiled: CompiledFinancialExpression,
  scope: Partial<Record<FinancialFormulaVariable, number | null | undefined>>
) {
  const evalNode = (node: ExprNode): number => {
    if (node.type === "number") return node.value;
    if (node.type === "identifier") {
      const raw = scope[node.name as FinancialFormulaVariable];
      const n = raw == null ? 0 : Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    if (node.type === "unary") {
      const v = evalNode(node.expr);
      return node.op === "-" ? -v : v;
    }

    const left = evalNode(node.left);
    const right = evalNode(node.right);

    if (node.op === "+") return left + right;
    if (node.op === "-") return left - right;
    if (node.op === "*") return left * right;
    if (node.op === "/") return right === 0 ? 0 : left / right;
    return Math.pow(left, right);
  };

  const result = evalNode(compiled.ast);
  return Number.isFinite(result) ? result : 0;
}

export function validateFinancialExpression(expression: string) {
  try {
    compileFinancialExpression(expression);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Expresión inválida";
  }
}

export function pickFormulaExpression(
  formulas: Record<string, unknown> | null | undefined,
  key: FinancialFormulaKey
) {
  const raw = formulas?.[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return FINANCIAL_FORMULA_DEFAULTS[key];
}
