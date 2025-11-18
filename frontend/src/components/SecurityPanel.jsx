export function SecurityPanel({ user, setupInfo, onSetup, onEnable }) {
  return (
    <div className="panel">
      <header>
        <h2>安全与 MFA</h2>
        {!user.mfaEnabled && (
          <button className="btn secondary" onClick={onSetup}>
            获取密钥
          </button>
        )}
      </header>
      {user.mfaEnabled ? (
        <p>✅ 已启用多因素认证</p>
      ) : (
        <div>
          <p>账户尚未启用 MFA，建议立即绑定验证器。</p>
          {setupInfo && (
            <div>
              <p>扫描二维码或手动输入密钥：</p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                    setupInfo.otpauth_url
                  )}`}
                  alt="MFA QR"
                />
                <code style={{ wordBreak: 'break-all' }}>{setupInfo.secret}</code>
              </div>
              <button
                className="btn primary"
                style={{ marginTop: '1rem' }}
                onClick={onEnable}
              >
                我已扫描，输入验证码启用
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

