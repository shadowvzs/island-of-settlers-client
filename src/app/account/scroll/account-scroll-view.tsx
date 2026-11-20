import { useExternalStore } from "../../components/external-store";
import type { ExternalStore } from "../../components/ui-store";
import { ChoicesPage } from "./choices-page";
import { LocalAccountsPrompt } from "./local-accounts-prompt";
import { RegistrationForm } from "./registration-form";
import type { ScrollPage, ShownScrollPage } from "./scroll-pages";
import { SignInForm } from "./sign-in-form";

interface ScrollPageViewProps {
  page: ScrollPage;
}
const ScrollPageView = ({ page }: ScrollPageViewProps) => {
  if (page.kind === "register") return <RegistrationForm {...page} />;
  if (page.kind === "localAccounts") return <LocalAccountsPrompt {...page} />;
  if (page.kind === "choices") return <ChoicesPage {...page} />;
  return <SignInForm {...page} />;
};

interface AccountScrollViewProps {
  pages: ExternalStore<ShownScrollPage | null>;
}
/**
 * The parchment scroll over the loading screen: a modal dialog, rollers around one page at a time (Register or
 * Sign in).
 */
export const AccountScrollView = ({ pages }: AccountScrollViewProps) => {
  const shown = useExternalStore(pages);
  return (
    <div aria-labelledby="account-scroll-title" aria-modal="true" className="account-scroll" role="dialog">
      <div aria-hidden="true" className="account-scroll__roller account-scroll__roller--top" />
      {shown && <ScrollPageView key={shown.id} page={shown.page} />}
      <div aria-hidden="true" className="account-scroll__roller account-scroll__roller--bottom" />
    </div>
  );
};
