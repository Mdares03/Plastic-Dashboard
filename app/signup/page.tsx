import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SignupForm from "./SignupForm";

export default async function SignupPage() {
  const session = (await cookies()).get("mis_session")?.value;
  if (session) {
    redirect("/machines");
  }

  return <SignupForm />;
}
