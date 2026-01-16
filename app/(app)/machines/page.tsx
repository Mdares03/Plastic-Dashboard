import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import MachinesClient from "./MachinesClient";

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export default async function MachinesPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/machines");

  const machines = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      heartbeats: {
        orderBy: { tsServer: "desc" },
        take: 1,
        select: { ts: true, tsServer: true, status: true, message: true, ip: true, fwVersion: true },
      },
    },
  });

  const initialMachines = machines.map((machine) => ({
    ...machine,
    latestHeartbeat: machine.heartbeats[0]
      ? {
          ...machine.heartbeats[0],
          ts: toIso(machine.heartbeats[0].ts) ?? "",
          tsServer: toIso(machine.heartbeats[0].tsServer),
        }
      : null,
    heartbeats: undefined,
  }));

  return <MachinesClient initialMachines={initialMachines} />;
}
