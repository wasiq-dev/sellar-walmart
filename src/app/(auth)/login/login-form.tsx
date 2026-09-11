"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { FormError } from "@/components/ui/fields";
import { useAuth } from "@/hooks/useAuth";
import { LoginSchema, fieldErrors } from "@/lib/definitions";
import { signIn, DUMMY_TOKEN } from "@/lib/mock-db";

type State = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
};

export default function LoginForm() {
  const [state, setState] = useState<State>({});
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const auth = useAuth();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const parsed = LoginSchema.safeParse({
      email: fd.get("email"),
      password: fd.get("password"),
    });
    if (!parsed.success) {
      setState({ errors: fieldErrors(parsed.error) });
      setPending(false);
      return;
    }
    // Offline: any valid-looking credentials sign you in.
    const user = signIn(parsed.data.email);
    auth.login(DUMMY_TOKEN, user);
    router.push("/");
  }

  return (
    <div>
      <h1 className="mb-7 text-center text-3xl font-extrabold text-[#2a2a2a]">
        Welcome!
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <FormError message={state.message} />

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-bold text-[#2a2a2a]">
            Email or User ID
          </label>
          <input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            required
            aria-invalid={Boolean(state.errors?.email)}
            className="w-full rounded-md border border-slate-300 px-3 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-wm-blue focus:ring-2 focus:ring-wm-blue/30"
          />
          {state.errors?.email?.[0] && (
            <p className="mt-1 text-xs text-rose-600">{state.errors.email[0]}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-bold text-[#2a2a2a]">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={Boolean(state.errors?.password)}
              className="w-full rounded-md border border-slate-300 px-3 py-3 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-wm-blue focus:ring-2 focus:ring-wm-blue/30"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition-colors hover:text-slate-700"
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
            </button>
          </div>
          {state.errors?.password?.[0] && (
            <p className="mt-1 text-xs text-rose-600">
              {state.errors.password[0]}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-[#efefef] px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-slate-500 transition-colors hover:bg-[#e3e3e3] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Forgot your{" "}
        <Link
          href="/signup"
          className="font-semibold text-wm-blue hover:underline"
        >
          Password
        </Link>
        ?
      </p>
    </div>
  );
}
