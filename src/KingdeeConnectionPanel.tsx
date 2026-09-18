import { useEffect, useRef, useState } from 'react'
import { Database, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import {
  fetchKingdeeConfig,
  probeKingdeeConnection,
  saveKingdeeConfig,
  type KingdeeConfig,
} from './kingdee-api'

interface KingdeeConnectionPanelProps {
  onConnectionChange: (connected: boolean) => void
  onEnter: () => Promise<void>
}

type ConnectionState = 'checking' | 'connected' | 'disconnected'

const AUTO_PROBE_DELAY_MS = 500

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

export default function KingdeeConnectionPanel({ onConnectionChange, onEnter }: KingdeeConnectionPanelProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [config, setConfig] = useState<KingdeeConfig>(emptyConfig)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [hasSavedSecret, setHasSavedSecret] = useState(false)
  const [secretVisible, setSecretVisible] = useState(false)
  const [busy, setBusy] = useState<'load' | 'probe' | 'enter' | null>('load')
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [status, setStatus] = useState('正在读取本机配置...')

  useEffect(() => {
    let cancelled = false
    const loadConfig = async () => {
      onConnectionChange(false)
      try {
        const saved = await fetchKingdeeConfig()
        if (cancelled) return
        const loadedConfig = { ...emptyConfig, ...saved, app_secret: '' }
        setConfig(loadedConfig)
        setHasSavedSecret(saved.has_app_secret)
        setConfigLoaded(true)
      } catch (error) {
        if (cancelled) return
        setConnectionState('disconnected')
        onConnectionChange(false)
        setStatus(error instanceof Error ? error.message : '无法读取本机配置')
      } finally {
        if (!cancelled) setBusy(null)
      }
    }
    void loadConfig()
    return () => { cancelled = true }
  }, [onConnectionChange])

  useEffect(() => {
    if (!configLoaded) return
    const hasRequiredFields = Boolean(
      config.base_url.trim()
      && config.dbid.trim()
      && config.username.trim()
      && config.appid.trim()
      && config.org_number.trim()
      && (hasSavedSecret || config.app_secret),
    )
    if (!hasRequiredFields) {
      setConnectionState('disconnected')
      onConnectionChange(false)
      setStatus(hasSavedSecret ? '请填写完整的金蝶连接信息' : '请填写完整的连接信息和 AppSecret')
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      const probe = async () => {
        setBusy('probe')
        setConnectionState('checking')
        onConnectionChange(false)
        setStatus('正在自动验证登录和物料读取权限...')
        try {
          const result = await probeKingdeeConnection(config)
          if (cancelled) return
          const connected = result.ok && result.material_access
          setConnectionState(connected ? 'connected' : 'disconnected')
          onConnectionChange(connected)
          setStatus(connected
            ? `连接成功 · ${result.elapsed_ms} ms · 已验证物料权限`
            : '金蝶服务已响应，但没有检测到可访问的电子物料')
        } catch (error) {
          if (cancelled) return
          setConnectionState('disconnected')
          onConnectionChange(false)
          setStatus(error instanceof Error ? error.message : '无法检测金蝶数据库')
        } finally {
          if (!cancelled) setBusy(null)
        }
      }
      void probe()
    }, AUTO_PROBE_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [config, configLoaded, hasSavedSecret, onConnectionChange])

  const update = <Key extends keyof KingdeeConfig>(key: Key, value: KingdeeConfig[Key]) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setConnectionState('disconnected')
    onConnectionChange(false)
    setStatus('连接配置已修改，等待自动检测...')
  }

  const formIsValid = () => {
    if (!formRef.current?.reportValidity()) return false
    if (!hasSavedSecret && !config.app_secret) {
      setStatus('首次连接时需要填写 AppSecret')
      return false
    }
    return true
  }

  const handleEnter = async () => {
    if (connectionState !== 'connected' || !formIsValid()) return
    setBusy('enter')
    setStatus('正在同步电子物料并进入 BOM 匹配系统...')
    try {
      await saveKingdeeConfig(config)
      await onEnter()
    } catch (error) {
      setConnectionState('disconnected')
      onConnectionChange(false)
      setStatus(error instanceof Error ? error.message : '无法进入 BOM 匹配系统')
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

      <div className="kingdee-config-gateway">
        <div className={`kingdee-database-status ${connectionState}`} role="status" aria-live="polite">
          {connectionState === 'checking' ? <LoaderCircle className="spin" size={22} /> : <Database size={22} />}
          <div>
            <strong>
              {connectionState === 'checking'
                ? '正在检测金蝶数据库'
                : connectionState === 'connected'
                  ? '检测到金蝶数据库'
                  : '没有检测到金蝶数据库'}
            </strong>
            <span>{status}</span>
          </div>
        </div>
        <button
          className="kingdee-enter-button"
          type="button"
          onClick={() => void handleEnter()}
          disabled={connectionState !== 'connected' || busy !== null}
        >
          {busy === 'enter' ? <LoaderCircle className="spin" size={18} /> : <Database size={18} />}
          <span>进入 BOM 匹配系统</span>
        </button>
      </div>

      <form
        ref={formRef}
        className="kingdee-config-form"
        autoComplete="off"
        onSubmit={(event) => event.preventDefault()}
      >
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
      </form>
    </div>
  )
}
