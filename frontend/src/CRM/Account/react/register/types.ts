import type { FormPayment, FormRecord } from "../../../form/react/types";

export type RegisterPaymentStatus = "process" | "checked" | "fail" | "all";

export type RegisterPaymentForm = FormRecord & {
  payments?: FormPayment[];
};
