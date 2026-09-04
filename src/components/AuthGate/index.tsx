import { ReactNode, useEffect, useState } from 'react';
import { Alert, Spin } from 'antd';
import { ensureOnedayClient } from '@/onedaycloud';
import { DATA_MODE } from '@/services/db';

/** 本地 Supabase 使用无感匿名会话；1d 模式的身份仍由宿主平台 SDK 提供。 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(DATA_MODE !== 'supabase');
  const [error, setError] = useState('');

  useEffect(() => {
    if (DATA_MODE !== 'supabase') return;
    const client = ensureOnedayClient();
    if (!client) { setError('Supabase 环境变量未配置'); return; }
    client.supabase.auth.getSession().then(async ({ data: { session } }: any) => {
      if (!session) {
        const result = await client.supabase.auth.signInAnonymously({ options: { data: { local_demo: true } } });
        if (result.error) throw result.error;
      }
      const roleResult = await client.supabase.rpc('set_local_demo_role', { p_role: 'leader' });
      if (roleResult.error) throw roleResult.error;
      setReady(true);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <div className="auth-screen"><Alert type="error" showIcon message="本地数据库连接失败" description={error} /></div>;
  if (!ready) return <div className="auth-screen"><Spin size="large" tip="正在连接本地 Supabase…" /></div>;
  return <>{children}</>;
}
