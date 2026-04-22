import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import InviteAcceptForm from "./InviteAcceptForm";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const session = (await cookies()).get("mis_session")?.value;
  if (session) {
    redirect("/machines");
  }

  const { token: rawToken } = await params;
  const token = String(rawToken || "").trim().toLowerCase();
  let invite = null;
  let error: string | null = null;

  if (!token) {
    error = "Invite not found";
  } else {
    invite = await prisma.orgInvite.findFirst({
      where: {
        token,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        org: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!invite) {
      error = "Invite not found";
    }
  }

  return (
    <InviteAcceptForm
      token={token}
      initialInvite={
        invite
          ? {
              email: invite.email,
              role: invite.role,
              org: invite.org,
              expiresAt: invite.expiresAt.toISOString(),
            }
          : null
      }
      initialError={error}
    />
  );
}
