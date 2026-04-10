import { navigateWithRouter } from "../router/navigationBridge";
import { stashLegacyLampPaymentSelection } from "./legacyPaymentSelection";
import { LAMP_META } from "./render_lamp_init.js";

const LAMP_ROUTE_PATH = "/lamp-registration";

export { LAMP_META };

export function render_payment_init(_app, selected) {
  stashLegacyLampPaymentSelection(selected);
  navigateWithRouter(LAMP_ROUTE_PATH);
}
