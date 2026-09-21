import { ArrowRight, BookOpen, Compass, Loader2, Lock, Mail, PenLine, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { BrandMark } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* Sign-in pages only render in accounts mode (other devices on the network). In personal mode App.tsx redirects home. */

const DEMO_ACCOUNTS: [string, string, string][] = [
  ["editor@interactivebible.local", "Editor", "Review queue, uploads, sermons"],
  ["member@interactivebible.local", "Member", "Church member · sermons"],
  ["admin@interactivebible.local", "Admin", "Everything, including system settings"],
];

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-[calc(100dvh-var(--header-h)-var(--bottom-nav-h))] lg:grid-cols-[1.05fr_1fr]">
      <aside className="hero-sky relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14" aria-hidden>
        <div className="star-field absolute inset-0 opacity-30" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <span className="font-display text-xl font-semibold">Interactive Bible App</span>
        </div>
        <div className="relative max-w-md">
          <blockquote className="font-serif text-[28px] leading-snug text-balance text-white/95">“Your word is a lamp to my feet, and a light for my path.”</blockquote>
          <div className="mt-3 font-display text-gold-300">Psalm 119:105</div>
          <ul className="mt-10 grid grid-cols-1 gap-4 text-[15px] text-white/80">
            <li className="flex items-center gap-3"><span className="grid grid-cols-1 size-9 place-items-center rounded-xl bg-white/10"><BookOpen className="size-[18px] text-gold-300" /></span> Read with verse-by-verse insight</li>
            <li className="flex items-center gap-3"><span className="grid grid-cols-1 size-9 place-items-center rounded-xl bg-white/10"><Compass className="size-[18px] text-gold-300" /></span> Explore the Bible world on a living atlas</li>
            <li className="flex items-center gap-3"><span className="grid grid-cols-1 size-9 place-items-center rounded-xl bg-white/10"><PenLine className="size-[18px] text-gold-300" /></span> Prepare, design and share sermons</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/50">Your data stays on this computer. AI requests go to Google Gemini only when you use an AI feature.</p>
      </aside>
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 lg:hidden"><BrandMark className="size-11" /></div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 text-[15px] text-ink-2">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, icon, ...props }: { id: string; label: string; icon: ReactNode } & React.ComponentProps<"input">) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Label htmlFor={id} className="text-ink-2">{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3">{icon}</span>
        <Input id={id} className="h-11 rounded-xl bg-card pl-10 text-[15px] dark:bg-white/[0.04]" {...props} />
      </div>
    </div>
  );
}

function useRedirectTarget() {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from || "/";
}

export function LoginPage() {
  const { login, viewer } = useAuth();
  const navigate = useNavigate();
  const from = useRedirectTarget();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (viewer?.authenticated && !busy) navigate(from, { replace: true });
  }, [viewer, busy, from, navigate]);

  const signIn = async (e: FormEvent | null, account?: string, pw?: string) => {
    e?.preventDefault();
    setBusy(account || "form");
    setError(null);
    try {
      await login(account || email, pw ?? password);
      toast.success("Welcome back");
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your sermons, library uploads and saved stories.">
      <form onSubmit={(e) => signIn(e)} className="grid grid-cols-1 gap-4">
        <Field id="email" label="Email" icon={<Mail className="size-4" />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="you@church.org" />
        <Field id="password" label="Password" icon={<Lock className="size-4" />} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="Your password" />
        {error && <p className="rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" className="h-11 rounded-xl text-[15px] font-semibold" disabled={!!busy}>
          {busy === "form" ? <Loader2 className="size-4 animate-spin" /> : null} Sign in
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-2">
        New here? <Link to="/signup" state={{ from }} className="font-semibold">Create an account</Link>
      </p>
      <div className="mt-8 rounded-2xl border border-dashed border-line-2 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-3 uppercase"><Sparkles className="size-3.5 text-gold-600 dark:text-gold-400" /> Try a sample account</div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {DEMO_ACCOUNTS.map(([account, role, desc]) => (
            <button
              key={account}
              type="button"
              onClick={() => signIn(null, account, "bible-demo")}
              disabled={!!busy}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left transition hover:border-gold-500/40 hover:bg-surface-2 disabled:opacity-60 dark:bg-white/[0.03]"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{role}</span>
                <span className="block truncate text-xs text-ink-3">{desc}</span>
              </span>
              {busy === account ? <Loader2 className="size-4 animate-spin text-ink-3" /> : <ArrowRight className="size-4 text-ink-3" />}
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signup, viewer } = useAuth();
  const navigate = useNavigate();
  const from = useRedirectTarget();
  const [form, setForm] = useState({ display_name: "", church: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (viewer?.authenticated && !busy) navigate(from === "/" ? "/sermons" : from, { replace: true });
  }, [viewer, busy, from, navigate]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup({ ...form, church: form.church || undefined });
      toast.success("Your account is ready");
      navigate(from === "/" ? "/sermons" : from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Create your account" subtitle="A free account on this app for sermons, uploads and study tools.">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4">
        <Field id="name" label="Your name" icon={<UserRound className="size-4" />} value={form.display_name} onChange={set("display_name")} required maxLength={80} placeholder="Pastor Ruth" autoComplete="name" />
        <Field id="church" label="Church or ministry (optional)" icon={<BookOpen className="size-4" />} value={form.church} onChange={set("church")} maxLength={120} placeholder="Grace Community Church" />
        <Field id="email" label="Email" icon={<Mail className="size-4" />} type="email" value={form.email} onChange={set("email")} required autoComplete="email" placeholder="you@church.org" />
        <Field id="password" label="Password" icon={<Lock className="size-4" />} type="password" value={form.password} onChange={set("password")} required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
        {error && <p className="rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" className="h-11 rounded-xl text-[15px] font-semibold" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Create account
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-2">
        Already have an account? <Link to="/login" state={{ from }} className="font-semibold">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
