import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";

import { messages as english } from "../locales/en/messages";
import { messages as hungarian } from "../locales/hu/messages";
import { parseReviewOptions } from "./helpers";
import { ReviewApp } from "./review-app";

import "../app/styles.css";
import "../app/settlement-ui/styles.css";
import "../app/settlement-ui/colony.css";
import "../app/settings/settings.css";
import "./review.css";

const options = parseReviewOptions(location.search);
const i18n = setupI18n({ locale: options.language, messages: { en: english, hu: { ...english, ...hungarian } } });
document.documentElement.dataset.hudTheme = options.theme;
document.documentElement.lang = options.language;
document.body.dataset.scene = options.scene;

createRoot(document.getElementById("review")!).render(
  <I18nProvider i18n={i18n}>
    <ReviewApp hold={options.hold} multiboard={options.multiboard} view={options.view} />
  </I18nProvider>
);
