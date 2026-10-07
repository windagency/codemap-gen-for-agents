import { helper, other } from "./barrel";

export function run(): string {
  return helper() + other();
}
