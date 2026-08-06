import { useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { MembershipRegistrationPage } from "./MembershipRegistrationPage";
import { YouthClassRegistrationPage } from "./YouthClassRegistrationPage";

type RegistrationSectionKey = "membership" | "youth_class";

function resolveSectionKey(value: string | null): RegistrationSectionKey {
  // 默认青少年班——会员管理已移到「用户与部门」分组，带 registration_section=membership 才进会员工作台。
  return value === "membership" ? "membership" : "youth_class";
}

export function LongOpenRegistrationFormPage() {
  useEnsureDesignTokens();

  const [searchParams] = useSearchParams();
  const activeSection = resolveSectionKey(searchParams.get("registration_section"));

  return activeSection === "membership" ? <MembershipRegistrationPage /> : <YouthClassRegistrationPage />;
}
