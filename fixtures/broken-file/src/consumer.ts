import { safe } from "./good";
import { broken } from "./broken";

export function run(): string {
  return safe();
}
