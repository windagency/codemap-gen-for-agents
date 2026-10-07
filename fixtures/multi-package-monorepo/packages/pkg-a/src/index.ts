import { greet } from "@fixture/pkg-b";
import { extLabel } from "@scope/ext-dep";

export function run(): string {
  return `${greet()} (${extLabel})`;
}
