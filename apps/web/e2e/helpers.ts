// Shared fixture helpers for the flow/regression specs added alongside this file (KOK-165).
// recipe-units.spec.ts defines its own local copies of the same shapes — kept separate there since
// it predates this file and touching it isn't in scope here. New specs should import from here.
import { expect, type Page } from "@playwright/test";

export function uniqueName(label: string): string {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function authenticatedHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === "kokoro_csrf")?.value;
  expect(token).toBeTruthy();
  return {
    Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    "X-CSRF-Token": token ?? "",
  };
}

export async function postJson<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: await authenticatedHeaders(page),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

/** Selects an option from a search-as-you-type picker (ItemPicker, CustomerPicker, …): fills the
 * picker's placeholder input, then clicks the exact-name result button it renders. */
export async function selectFromPicker(
  page: Page,
  placeholder: string,
  name: string,
): Promise<void> {
  const picker = page.getByPlaceholder(placeholder);
  await picker.fill(name);
  await page.getByRole("button", { name, exact: true }).click();
}
