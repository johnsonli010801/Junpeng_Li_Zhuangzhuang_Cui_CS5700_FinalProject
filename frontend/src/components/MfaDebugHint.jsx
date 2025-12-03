import { useAuthStore } from '../store/useAuthStore.js';

export function MfaDebugHint() {
  const code = useAuthStore((state) => state.mfaDebugCode);

  // Only show when there is an active MFA code
  if (!code) {
    return null;
  }

  return (
    <div className="mfa-debug-hint">
      <span>MFA code:</span>
      <strong>{code}</strong>
    </div>
  );
}


