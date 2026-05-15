const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

let backendProcess = null

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort

    function tryPort() {
      const server = net.createServer()
      server.once('error', () => {
        port += 1
        if (port > startPort + 80) {
          reject(new Error(`No free port found from ${startPort}`))
          return
        }
        tryPort()
      })
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port, '127.0.0.1')
    }

    tryPort()
  })
}

function waitForHealth(port, timeoutMs = 25000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume()
        if (res.statusCode === 200) {
          resolve()
          return
        }
        retry()
      })
      req.on('error', retry)
      req.setTimeout(1200, () => {
        req.destroy()
        retry()
      })
    }

    function retry() {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Backend service did not become ready in time.'))
        return
      }
      setTimeout(check, 400)
    }

    check()
  })
}

function getPackagedBackendPath() {
  const executable = process.platform === 'win32' ? 'projectvault-backend.exe' : 'projectvault-backend'
  return path.join(process.resourcesPath, 'backend', executable)
}

async function startPackagedBackend() {
  const port = await findFreePort(Number(process.env.KB_PORT || 18110))
  const backendPath = getPackagedBackendPath()
  const frontendDir = path.join(process.resourcesPath, 'frontend')
  const dataDir = path.join(app.getPath('userData'), 'data')

  if (!fs.existsSync(backendPath)) {
    throw new Error(`Backend executable not found: ${backendPath}`)
  }

  fs.mkdirSync(dataDir, { recursive: true })

  backendProcess = spawn(backendPath, [], {
    env: {
      ...process.env,
      KB_PORT: String(port),
      KB_HOST: '127.0.0.1',
      KB_DATA_DIR: dataDir,
      KB_FRONTEND_DIR: frontendDir,
    },
    windowsHide: true,
    stdio: 'ignore',
  })

  backendProcess.once('exit', () => {
    backendProcess = null
  })

  await waitForHealth(port)
  return `http://127.0.0.1:${port}`
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: 'ProjectVault Agent',
    backgroundColor: '#f4f6f3',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  window.loadURL(url)
}

app.whenReady().then(async () => {
  try {
    const url = process.env.APP_URL || (app.isPackaged ? await startPackagedBackend() : 'http://127.0.0.1:5180')
    createWindow(url)
  } catch (error) {
    dialog.showErrorBox('ProjectVault Agent 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const url = process.env.APP_URL || 'http://127.0.0.1:5180'
      createWindow(url)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
})
