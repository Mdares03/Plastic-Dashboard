"use client";

import { useI18n } from "@/lib/i18n/useI18n";

/**
 * A4 — "How the numbers work" methodology page.
 *
 * A client-facing, plain-language explanation of every headline metric, written so a
 * mismatch a viewer *thinks* they see (e.g. live OEE vs period-average OEE) is explained
 * up front rather than read as a broken system. Content is bilingual inline (the audience
 * is es-MX; en kept in parity) so it needs no per-string i18n keys to stay maintainable.
 *
 * Wording mirrors docs/METRICS_SPEC.md (R-rules) and docs/ROI_MODEL.md so the in-app
 * text and the engineering spec never drift.
 */

type Section = {
  id: string;
  title: { en: string; es: string };
  body: { en: string[]; es: string[] };
};

const SECTIONS: Section[] = [
  {
    id: "source",
    title: { en: "One source of truth", es: "Una sola fuente de verdad" },
    body: {
      en: [
        "Every screen — dashboard, machine detail, daily recap, weekly report and the financial page — reads the same calculation engine. None of them recompute a metric their own way.",
        "That means a number you see on one screen is the same number behind every other screen. When two views differ, it is always for one of the explainable reasons below — never because one of them is wrong.",
      ],
      es: [
        "Cada pantalla — tablero, detalle de máquina, resumen diario, reporte semanal y la página financiera — lee el mismo motor de cálculo. Ninguna recalcula una métrica a su manera.",
        "Esto significa que un número que ves en una pantalla es el mismo número detrás de cualquier otra. Cuando dos vistas difieren, siempre es por una de las razones explicables de abajo — nunca porque una esté mal.",
      ],
    },
  },
  {
    id: "oee",
    title: { en: "OEE = Availability × Performance × Quality", es: "OEE = Disponibilidad × Desempeño × Calidad" },
    body: {
      en: [
        "Availability: share of scheduled time the machine was actually running (not stopped).",
        "Performance: actual cycle speed versus the theoretical ideal cycle for the running mold.",
        "Quality: good parts versus total parts produced.",
        "OEE is the product of the three. A missing input shows as “—”, never as 0 % or 100 % — a blank is honest, a fake number is not.",
      ],
      es: [
        "Disponibilidad: porción del tiempo programado en que la máquina realmente estuvo produciendo (no detenida).",
        "Desempeño: velocidad de ciclo real contra el ciclo ideal teórico del molde en operación.",
        "Calidad: piezas buenas contra el total de piezas producidas.",
        "El OEE es el producto de los tres. Si falta un dato se muestra “—”, nunca 0 % ni 100 % — un espacio en blanco es honesto, un número inventado no lo es.",
      ],
    },
  },
  {
    id: "live-vs-window",
    title: { en: "“Live” vs “period average”", es: "“En vivo” vs “promedio del periodo”" },
    body: {
      en: [
        "The dashboard and machine-detail tiles show the LIVE value: the latest reading, and only if it is fresher than 10 minutes. If the latest reading is older than that, the tile shows “—” (no live data) instead of a stale number dressed up as current.",
        "The daily recap and reports show a PERIOD AVERAGE: a time-weighted average across the whole window (today, last 7 days, etc.).",
        "So a live OEE of 82 % and a “Today” average OEE of 75 % are both correct — one is this moment, the other is the whole day. The caption under each number tells you which one you are looking at.",
      ],
      es: [
        "Los recuadros del tablero y del detalle de máquina muestran el valor EN VIVO: la última lectura, y solo si tiene menos de 10 minutos. Si la última lectura es más vieja, el recuadro muestra “—” (sin datos en vivo) en lugar de un número viejo disfrazado de actual.",
        "El resumen diario y los reportes muestran un PROMEDIO DEL PERIODO: un promedio ponderado por tiempo sobre toda la ventana (hoy, últimos 7 días, etc.).",
        "Por eso un OEE en vivo de 82 % y un OEE promedio de “Hoy” de 75 % son ambos correctos — uno es este momento, el otro es todo el día. La leyenda debajo de cada número te dice cuál estás viendo.",
      ],
    },
  },
  {
    id: "downtime",
    title: { en: "Planned vs unplanned downtime", es: "Paro planeado vs no planeado" },
    body: {
      en: [
        "Planned downtime (e.g. a mold change) is necessary work — it is shown but never counted as a loss to chase.",
        "Unplanned downtime is the reducible loss: unexpected stops. The 20 % reduction goal and the ROI are measured against unplanned downtime only.",
        "Downtime totals come from one place (the recorded stop episodes), clamped to the window and capped so a single never-closed stop cannot inflate the numbers.",
      ],
      es: [
        "El paro planeado (p. ej. un cambio de molde) es trabajo necesario — se muestra pero nunca se cuenta como pérdida a reducir.",
        "El paro no planeado es la pérdida reducible: paros inesperados. La meta de 20 % de reducción y el ROI se miden solo contra el paro no planeado.",
        "Los totales de paro vienen de un solo lugar (los episodios de paro registrados), recortados a la ventana y con un tope para que un paro que nunca se cerró no infle los números.",
      ],
    },
  },
  {
    id: "shifts",
    title: { en: "Downtime is shift-aware", es: "El paro respeta los turnos" },
    body: {
      en: [
        "Downtime is counted only inside your configured production shifts — on every screen alike. Idle time at night or on weekends, when no shift is scheduled, is not counted as a loss.",
        "If no shift schedule is configured, the plant is treated as running 24/7 and all hours count. Configure shifts in Settings → Shifts so the metrics reflect your real production calendar.",
      ],
      es: [
        "El paro se cuenta solo dentro de tus turnos de producción configurados — igual en todas las pantallas. El tiempo inactivo de noche o en fin de semana, cuando no hay turno programado, no se cuenta como pérdida.",
        "Si no hay turnos configurados, se asume que la planta opera 24/7 y todas las horas cuentan. Configura los turnos en Configuración → Turnos para que las métricas reflejen tu calendario real de producción.",
      ],
    },
  },
  {
    id: "unclassified",
    title: { en: "Unclassified downtime", es: "Paro sin clasificar" },
    body: {
      en: [
        "When a stop is detected but no one assigns a reason, it is recorded as “unclassified”. The stop still counts in the downtime total — it is just not yet attributed to a cause.",
        "A high unclassified share doesn’t mean the data is wrong; it means the biggest improvement opportunity is still unattributed. The more stops operators classify, the sharper the “where to act” analysis becomes.",
      ],
      es: [
        "Cuando se detecta un paro pero nadie le asigna una razón, se registra como “sin clasificar”. El paro sí cuenta en el total — simplemente aún no se le atribuye una causa.",
        "Un porcentaje alto sin clasificar no significa que el dato esté mal; significa que la mayor oportunidad de mejora todavía no tiene causa. Entre más paros clasifiquen los operadores, más preciso es el análisis de “dónde actuar”.",
      ],
    },
  },
  {
    id: "roi",
    title: { en: "How the 20 % reduction and ROI are measured", es: "Cómo se mide la reducción del 20 % y el ROI" },
    body: {
      en: [
        "We set a baseline of monthly unplanned-downtime minutes, then each month compare against it: reduction = (baseline − current) ÷ baseline. The target is a sustained 20 % or more.",
        "Money saved = downtime minutes removed × the plant’s loaded cost per stopped minute (machine + operator + energy), set in Settings → Financial. The downtime minutes are real and measured; the peso figure is only as accurate as the cost rates you enter.",
        "Crucially, the downtime number in the ROI is the exact same number the dashboard shows — you can verify the ROI on your own screen at any time.",
      ],
      es: [
        "Fijamos una línea base de minutos de paro no planeado al mes y cada mes comparamos contra ella: reducción = (base − actual) ÷ base. La meta es 20 % o más, sostenido.",
        "Dinero ahorrado = minutos de paro eliminados × el costo cargado por minuto detenido de la planta (máquina + operador + energía), configurado en Configuración → Financiero. Los minutos de paro son reales y medidos; la cifra en pesos es tan precisa como las tarifas de costo que captures.",
        "Lo más importante: el número de paro del ROI es exactamente el mismo que muestra el tablero — puedes verificar el ROI en tu propia pantalla en cualquier momento.",
      ],
    },
  },
  {
    id: "consistency",
    title: { en: "Built-in consistency check", es: "Verificación de consistencia integrada" },
    body: {
      en: [
        "An administrator can open Settings to see a live integrity panel that re-checks, on demand, that the dashboard, the reports and the financial figures all reconcile to the same source within rounding. If any screen ever drifted, this panel would flag it — so trust in the numbers is something you can audit, not just take on faith.",
      ],
      es: [
        "Un administrador puede abrir Configuración y ver un panel de integridad en vivo que verifica, a demanda, que el tablero, los reportes y las cifras financieras concilian con la misma fuente dentro del redondeo. Si alguna pantalla se desviara, este panel lo marcaría — así la confianza en los números es algo que puedes auditar, no solo creer.",
      ],
    },
  },
];

export default function MethodologyPage() {
  const { locale } = useI18n();
  const lang: "en" | "es" = locale === "en" ? "en" : "es";

  const pageTitle = lang === "en" ? "How the metrics work" : "Cómo se calculan las métricas";
  const pageIntro =
    lang === "en"
      ? "A plain-language guide to every headline number — what it means, and why two screens can show different (but both correct) values."
      : "Una guía en lenguaje claro de cada número clave — qué significa y por qué dos pantallas pueden mostrar valores distintos (pero ambos correctos).";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-white">{pageTitle}</h1>
      <p className="mt-2 text-sm text-zinc-400">{pageIntro}</p>

      <div className="mt-8 space-y-6">
        {SECTIONS.map((section) => (
          <section
            key={section.id}
            className="rounded-2xl border border-white/10 bg-white/5 p-6"
          >
            <h2 className="text-lg font-semibold text-emerald-300">{section.title[lang]}</h2>
            <div className="mt-3 space-y-2">
              {section.body[lang].map((para, i) => (
                <p key={i} className="text-sm leading-relaxed text-zinc-300">
                  {para}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
