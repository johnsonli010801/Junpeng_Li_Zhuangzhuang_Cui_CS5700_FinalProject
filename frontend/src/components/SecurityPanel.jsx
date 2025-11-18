export function SecurityPanel({ user, setupInfo, onSetup, onEnable }) {
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
        <h2 style={{ margin: 0 }}>🔐 安全与 MFA</h2>
        {!user.mfaEnabled && (
          <button className="btn secondary btn-sm" onClick={onSetup}>
            获取密钥
          </button>
        )}
      </div>
      
      {user.mfaEnabled ? (
        <div className="mfa-section">
          <div className="mfa-badge enabled">
            <span>✅</span>
            多因素认证已启用
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--spacing-md)' }}>
            您的账户已受到多因素认证保护
          </p>
        </div>
      ) : (
        <div className="mfa-section">
          <div className="mfa-badge">
            <span>⚠️</span>
            多因素认证未启用
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--spacing-md)' }}>
            建议启用 MFA 以提高账户安全性。请使用 Google Authenticator 或类似应用。
          </p>
          
          {setupInfo && (
            <div style={{ marginTop: 'var(--spacing-lg)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: 'var(--spacing-md)' }}>
                扫描二维码或手动输入密钥
              </h3>
              <div className="qr-code-container">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    setupInfo.otpauth_url
                  )}`}
                  alt="MFA QR Code"
                  style={{ borderRadius: 'var(--radius-md)' }}
                />
              </div>
              <div style={{ 
                padding: 'var(--spacing-md)', 
                background: 'var(--gray-100)', 
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--spacing-md)'
              }}>
                <label style={{ 
                  display: 'block', 
                  fontSize: '0.875rem', 
                  color: 'var(--text-secondary)', 
                  marginBottom: 'var(--spacing-sm)',
                  fontWeight: 500 
                }}>
                  密钥 (手动输入)
                </label>
                <code style={{ 
                  wordBreak: 'break-all', 
                  fontSize: '0.9375rem',
                  color: 'var(--text-primary)',
                  fontWeight: 600
                }}>
                  {setupInfo.secret}
                </code>
              </div>
              <button
                className="btn primary"
                onClick={onEnable}
              >
                我已扫描，输入验证码启用 MFA
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}



