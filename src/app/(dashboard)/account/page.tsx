import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SectionLanding } from "@/components/layout/SectionLanding";
import { KeyRound, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AccountLanding() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <SectionLanding
      title="My account"
      description="Password, two-factor, recovery codes."
      groups={[
        {
          links: [
            {
              href: "/account/change-password",
              title: "Change password",
              description: "Replace your sign-in password.",
              icon: KeyRound,
            },
            {
              href: "/account/security",
              title: "Security",
              description: "Enrol an authenticator app, manage recovery codes.",
              icon: ShieldCheck,
            },
          ],
        },
      ]}
    />
  );
}
