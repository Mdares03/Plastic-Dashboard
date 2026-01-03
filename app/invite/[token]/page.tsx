import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import InviteAcceptForm from "./InviteAcceptForm";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = (await cookies()).get("mis_session")?.value;
  if (session) {
    redirect("/machines");
  }

  return <InviteAcceptForm token={params.token} />;
}
