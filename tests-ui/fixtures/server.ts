/** The one Vite dev server of the browser test layers (UI_TEST_PORT overrides the port). */
export const UI_TEST_PORT = Number(process.env.UI_TEST_PORT ?? 5287);

export const UI_TEST_URL = `http://localhost:${UI_TEST_PORT}/`;
