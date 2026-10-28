import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../context/StoreContext';

// Where a signed-in user lands: shop owners go to their dashboard, or to shop setup if they have no shop yet.
const homeFor = (user) =>
  user.isAdmin ? '/admin' : user.shopId ? '/seller' : user.accountType === 'seller' ? '/sell#register' : '/account';

// Sign-up and sign-in, run by Clerk: email and password, or Google. A new account (and a sign-in from a new device)
// confirms the email address with a 6-digit code.
export default function Login() {
  const { user, signUp, signIn, verifyCode, signInWithGoogle, requestPasswordReset, resetPassword } = useStore();
  const [params] = useSearchParams();
  const next = params.get('next');
  const ref = params.get('ref') ?? '';
  // Sign-up links and QR codes: ?join=seller (shop owners) or ?join=buyer (customers).
  const join = params.get('join');
  const [mode, setMode] = useState(ref || join ? 'register' : 'login');
  const [code, setCode] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    accountType: join === 'seller' ? 'seller' : 'buyer',
    referralCode: ref.toUpperCase(),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [reset, setReset] = useState({ code: '', password: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const destination = (u) => (next?.startsWith('/') ? next : homeFor(u));

  // Also performs the redirect right after signing in, so there is only one navigation.
  if (user) return <Navigate to={destination(user)} replace />;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (mode === 'register') {
      if (form.name.trim().length < 2) return setError('Enter your full name');
      if (form.password.length < 8) return setError('Use a password of at least 8 characters');
      run(async () => {
        const step = await signUp({ ...form, name: form.name.trim(), email: form.email.trim(), referralCode: form.referralCode.trim().toUpperCase() });
        if (step?.needsCode) askForCode();
      });
    } else {
      run(async () => {
        const step = await signIn({ email: form.email.trim(), password: form.password });
        if (step?.needsCode) askForCode();
      });
    }
  };

  const askForCode = () => {
    setMode('code');
    setCode('');
    setBusy(false);
  };

  const tabs = (
    <div className="tabs">
      <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
        Sign in
      </button>
      <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
        Create account
      </button>
    </div>
  );

  if (mode === 'reset') {
    const send = (e) => {
      e.preventDefault();
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Enter the email address of your account');
      run(async () => {
        await requestPasswordReset(form.email.trim());
        setResetSent(true);
        setBusy(false);
      });
    };
    const save = (e) => {
      e.preventDefault();
      if (reset.password.length < 8) return setError('Use a new password of at least 8 characters');
      run(() => resetPassword({ otp: reset.code.trim(), password: reset.password }));
    };
    return (
      <div className="container section narrow">
        <div className="card form-card auth">
          <h2>Set a new password</h2>
          {!resetSent ? (
            <form onSubmit={send} noValidate>
              <p className="muted small">We'll email you a 6-digit code.</p>
              <div className="field">
                <label htmlFor="r-email">Email</label>
                <input id="r-email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
              </div>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
          ) : (
            <form onSubmit={save} noValidate>
              <p className="muted small">
                Enter the code we sent to <strong>{form.email}</strong> and choose a new password.
              </p>
              <div className="field">
                <label htmlFor="r-code">6-digit code</label>
                <input id="r-code" inputMode="numeric" maxLength={6} value={reset.code} onChange={(e) => setReset((r) => ({ ...r, code: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="r-password">New password</label>
                <input id="r-password" type="password" autoComplete="new-password" value={reset.password} onChange={(e) => setReset((r) => ({ ...r, password: e.target.value }))} />
              </div>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
          <button className="link-btn block center" onClick={() => { setMode('login'); setResetSent(false); setError(null); }}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'code') {
    const confirm = (e) => {
      e.preventDefault();
      if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email');
      run(() => verifyCode(code.trim()));
    };
    return (
      <div className="container section narrow">
        <div className="card form-card auth">
          <h2>Check your email</h2>
          <form onSubmit={confirm} noValidate>
            <p className="muted small">
              We sent a 6-digit code to <strong>{form.email}</strong>. It can take a minute to arrive; look in spam too.
            </p>
            <div className="field">
              <label htmlFor="c-code">6-digit code</label>
              <input id="c-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Checking…' : 'Confirm'}
            </button>
          </form>
          <button className="link-btn block center" onClick={() => { setMode('login'); setError(null); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container section narrow">
      <div className="card form-card auth">
        {tabs}
        <form onSubmit={submit} noValidate>
          {mode === 'register' && (
            <>
              <div className="field">
                <label htmlFor="a-name">Full name</label>
                <input id="a-name" value={form.name} onChange={set('name')} autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="a-type">I am a</label>
                <select id="a-type" value={form.accountType} onChange={set('accountType')}>
                  <option value="buyer">Shopper</option>
                  <option value="business">Business buyer (wholesale)</option>
                  <option value="seller">Shop owner (I want to sell)</option>
                </select>
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="a-email">Email</label>
            <input id="a-email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="a-password">Password</label>
            <input
              id="a-password"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
            {mode === 'register' && <span className="muted small">At least 8 characters.</span>}
            {mode === 'login' && (
              <button type="button" className="link-btn small" onClick={() => { setMode('reset'); setError(null); }}>
                Forgot password?
              </button>
            )}
          </div>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="a-ref">Invite code (optional)</label>
              <input id="a-ref" value={form.referralCode} onChange={set('referralCode')} placeholder="e.g. ZMA1B2C3" />
              {form.referralCode && <span className="muted small">🎁 You get a voucher when you join with an invite code.</span>}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="auth-or">or</div>
        <button
          className="btn btn-outline btn-block"
          disabled={busy}
          onClick={() => run(() => signInWithGoogle(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`))}
        >
          Continue with Google
        </button>
        <p className="muted small center">
          By continuing you agree to our <Link to="/legal/terms">terms</Link> and{' '}
          <Link to="/legal/privacy">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
