import { loginAction } from "@/app/login/actions";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations();
  const from = params.from && params.from.startsWith("/") && !params.from.startsWith("//") ? params.from : "/";

  return (
    <div className="login-screen">
      <form action={loginAction} className="login-card">
        <div className="brand">
          <span className="nf brand-icon" aria-hidden></span>
          <div>
            <strong>{process.env.NEXT_PUBLIC_APP_NAME || "NervaBrain"}</strong>
            <span>{t["login.signIn"]}</span>
          </div>
        </div>
        <input type="hidden" name="from" value={from} />
        <label htmlFor="password">{t["login.password"]}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          required
          maxLength={512}
        />
        {params.error ? <p className="login-error">{t["login.incorrect"]}</p> : null}
        <button type="submit">{t["login.continue"]}</button>
      </form>
    </div>
  );
}
