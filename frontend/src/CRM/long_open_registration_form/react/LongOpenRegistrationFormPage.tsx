import { useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { MembershipRegistrationPage } from "./MembershipRegistrationPage";
import { YouthClassRegistrationPage } from "./YouthClassRegistrationPage";

type RegistrationSectionKey = "membership" | "youth_class";

function resolveSectionKey(value: string | null): RegistrationSectionKey {
  return value === "youth_class" ? "youth_class" : "membership";
}

export function LongOpenRegistrationFormPage() {
  useEnsureDesignTokens();

  const [searchParams] = useSearchParams();
  const activeSection = resolveSectionKey(searchParams.get("registration_section"));

  return activeSection === "membership" ? <MembershipRegistrationPage /> : <YouthClassRegistrationPage />;
}
