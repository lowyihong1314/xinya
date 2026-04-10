import { navigateWithRouter } from "../router/navigationBridge";
import { LAMP_META } from "./lampMeta";

const LAMP_ROUTE_PATH = "/lamp-registration";

export { LAMP_META };

export async function render_lamp_init(_app) {
  navigateWithRouter(LAMP_ROUTE_PATH);
}
