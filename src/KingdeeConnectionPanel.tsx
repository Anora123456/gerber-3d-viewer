import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Database, Eye, EyeOff, LoaderCircle, Save } from 'lucide-react'
import {
  fetchKingdeeConfig,
  probeKingdeeConnection,
  saveKingdeeConfig,
  type KingdeeConfig,
} from './kingdee-api'

interface KingdeeConnectionPanelProps {
  onSaved: () => Promise<void>
}

const emptyConfig: KingdeeConfig = {
  base_url: '',
  dbid: '',
  username: '',
  appid: '',
  app_secret: '',
  protocol: 'v4',
  lcid: '2052',
  org_number: '100',
}

export default function KingdeeConnectionPanel({ onSaved }: KingdeeConnectionPanelProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [config, setConfig] = useState<KingdeeConfig>(emptyConfig)
  const [hasSavedSecret, setHasSavedSecret] = useState(false)
  const [secretVisible, setSecretVisible] = useState(false)
  const [busy, setBusy] = useState<'load' | 'probe' | 'save' | null>('load')
  const [status, setStatus] = useState('正在读取本机配置...')
  const [statusError, setStatusError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchKingdeeConfig()
      .then((saved) => {
        if (cancelled) return
        setConfig((current) => ({ ...current, ...saved, app_secret: '' }))
        setHasSavedSecret(saved.has_app_secret)
        setStatus(saved.has_app_secret ? '已载入本机连接配置' : '尚未保存应用密钥')
        setStatusError(false)
      })
      .catch((error) => {
        if (cancelled) return
        setStatus(error instanceof Error ? error.message : '无法读取本机配置')
        setStatusError(true)
      })
      .finally(() => {
        if (!cancelled) setBusy(null)
      })
    return () => { cancelled = true }
  }, [])

  const update = <Key extends keyof KingdeeConfig>(key: Key, value: KingdeeConfig[Key]) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const formIsValid = () => {
    if (!formRef.current?.reportValidity()) return false
    if (!hasSavedSecret && !config.app_secret) {
      setStatus('首次连接时需要填写 AppSecret')
      setStatusError(true)
      return false
    }
    return true
  }

  const handleProbe = async () => {
    if (!formIsValid()) return
    setBusy('probe')
    setStatus('正在验证登录和物料读取权限...')
    setStatusError(false)
    try {
      const result = await probeKingdeeConnection(config)
      setStatus(`连接成功 · ${result.elapsed_ms} ms · 已验证物料权限`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '连接失败')
      setStatusError(true)
    } finally {
      setBusy(null)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formIsValid()) return
    setBusy('save')
    setStatus('正在保存配置并同步电子物料...')
    setStatusError(false)
    try {
      const saved = await saveKingdeeConfig(config)
      setConfig((current) => ({ ...current, ...saved, app_secret: '' }))
      setHasSavedSecret(saved.has_app_secret)
      await onSaved()
      setStatus('配置已保存，物料数据同步完成')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存或同步失败')
      setStatusError(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="kingdee-config-shell">
      <div className="kingdee-config-brand">
        <span><Database size={28} /></span>
        <div>
          <strong>金蝶 ERP</strong>
          <small>通过 K/3 Cloud WebAPI 同步电子物料</small>
        </div>
      </div>

      <form ref={formRef} className="kingdee-config-form" autoComplete="off" onSubmit={handleSubmit}>
        <label className="kingdee-field kingdee-field-wide">
          <span>服务地址</span>
          <input
            type="url"
            required
            value={config.base_url}
            onChange={(event) => update('base_url', event.target.value)}
            placeholder="https://example.com/K3Cloud/"
            spellCheck={false}
          />
        </label>

        <div className="kingdee-field-grid">
          <label className="kingdee-field">
            <span>数据中心 ID</span>
            <input
              required
              value={config.dbid}
              onChange={(event) => update('dbid', event.target.value)}
              placeholder="请输入数据中心 ID"
              spellCheck={false}
            />
          </label>
          <label className="kingdee-field">
            <span>集成用户</span>
            <input
              required
              value={config.username}
              onChange={(event) => update('username', event.target.value)}
              placeholder="请输入业务用户名称"
            />
          </label>
        </div>

        <label className="kingdee-field kingdee-field-wide">
          <span>AppID</span>
          <input
            required
            value={config.appid}
            onChange={(event) => update('appid', event.target.value)}
            placeholder="请输入第三方系统应用 ID"
            spellCheck={false}
          />
        </label>

        <label className="kingdee-field kingdee-field-wide">
          <span>AppSecret</span>
          <div className="kingdee-secret-control">
            <input
              type={secretVisible ? 'text' : 'password'}
              value={config.app_secret}
              onChange={(event) => update('app_secret', event.target.value)}
              placeholder={hasSavedSecret ? '已保存，留空保持现有密钥' : '请输入应用密钥'}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setSecretVisible((visible) => !visible)}
              aria-label={secretVisible ? '隐藏密钥' : '显示密钥'}
              title={secretVisible ? '隐藏密钥' : '显示密钥'}
            >
              {secretVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        <div className="kingdee-options-grid">
          <label className="kingdee-field">
            <span>使用组织</span>
            <input
              required
              value={config.org_number}
              onChange={(event) => update('org_number', event.target.value)}
              placeholder="组织编码"
              spellCheck={false}
            />
          </label>
          <fieldset className="kingdee-field kingdee-protocol-field">
            <legend>登录协议</legend>
            <div className="kingdee-segmented">
              <button
                type="button"
                className={config.protocol === 'v4' ? 'active' : ''}
                onClick={() => update('protocol', 'v4')}
                aria-pressed={config.protocol === 'v4'}
              >V4 · SHA-256</button>
              <button
                type="button"
                className={config.protocol === 'v2' ? 'active' : ''}
                onClick={() => update('protocol', 'v2')}
                aria-pressed={config.protocol === 'v2'}
              >V2 · SHA-1</button>
            </div>
          </fieldset>
        </div>

        <div className="kingdee-form-actions">
          <output className={statusError ? 'error' : ''} aria-live="polite">{status}</output>
          <div>
            <button
              className="kingdee-button secondary"
              type="button"
              onClick={() => void handleProbe()}
              disabled={busy !== null}
            >
              {busy === 'probe' ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              <span>测试连接</span>
            </button>
            <button className="kingdee-button primary" type="submit" disabled={busy !== null}>
              {busy === 'save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              <span>保存配置</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
