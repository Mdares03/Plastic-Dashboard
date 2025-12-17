import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm"; // adjust path if needed


export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const session = (await cookies()).get("mis_session")?.value;

  // If already logged in, send to next or machines
  if (session) {
    const next = searchParams?.next || "/machines";
    redirect(next);
  }

  // ...your existing login UI below
    return <LoginForm />; // ✅ actually render it

}
