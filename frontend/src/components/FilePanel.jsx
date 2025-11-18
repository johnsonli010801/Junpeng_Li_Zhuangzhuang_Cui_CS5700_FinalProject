import { useState } from 'react';

export function FilePanel({ onUpload, disabled }) {
  const [file, setFile] = useState(null);

  const handleUpload = () => {
    if (!file) return;
    onUpload(file);
    setFile(null);
  };

  return (
    <div className="panel file-panel">
      <header>
        <h2>文件共享</h2>
      </header>
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={disabled}
      />
      <button
        className="btn secondary"
        style={{ marginTop: '0.5rem' }}
        onClick={handleUpload}
        disabled={!file || disabled}
      >
        上传并推送
      </button>
    </div>
  );
}



