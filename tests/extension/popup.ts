import { expose } from '../../src/index'
import type { TestAPI } from './background'
import * as popupTests from './popup-tests'
import { setApi } from './popup-tests'

const jsonOnlyCapabilities = {
  jsonOnly: true,
  messagePort: false,
  arrayBuffer: false,
  transferable: false,
  transferableStream: false
}

const port = chrome.runtime.connect({ name: `popup-${Date.now()}` })
const api = await expose<TestAPI>({}, {
  transport: { isJson: true, emit: port, receive: port },
  platformCapabilities: jsonOnlyCapabilities
})

setApi(api)

const tests = { Popup: popupTests }
globalThis.tests = tests

// UI elements for manual testing
const statusEl = document.getElementById('status')!
const runTestsBtn = document.getElementById('run-tests') as HTMLButtonElement
const resultsEl = document.getElementById('results')!

type TestObject = {
  [key: string]: TestObject | ((...args: any[]) => any)
}

const runAllTests = async () => {
  const results: { name: string; passed: boolean; error?: string }[] = []

  const runTestsRecursive = async (obj: TestObject, path: string[] = []) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'function' && key !== 'setApi') {
        const testName = [...path, key].join('.')
        try {
          await value()
          results.push({ name: testName, passed: true })
        } catch (error) {
          results.push({
            name: testName,
            passed: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      } else if (typeof value === 'object' && value !== null) {
        await runTestsRecursive(value as TestObject, [...path, key])
      }
    }
  }

  await runTestsRecursive(tests)
  return results
}

const displayResults = (results: { name: string; passed: boolean; error?: string }[]) => {
  resultsEl.innerHTML = results.map(r => `
    <div class="test-result ${r.passed ? 'passed' : 'failed'}">
      <span class="status">${r.passed ? '\u2713' : '\u2717'}</span>
      <span class="name">${r.name}</span>
      ${r.error ? `<span class="error">${r.error}</span>` : ''}
    </div>
  `).join('')

  const passed = results.filter(r => r.passed).length
  resultsEl.innerHTML += `<div class="summary">${passed}/${results.length} tests passed</div>`
}

runTestsBtn.addEventListener('click', async () => {
  runTestsBtn.disabled = true
  statusEl.textContent = 'Running tests...'
  resultsEl.innerHTML = ''

  try {
    const results = await runAllTests()
    displayResults(results)
    const passed = results.filter(r => r.passed).length
    statusEl.textContent = `Complete: ${passed}/${results.length} passed`
  } catch (error) {
    statusEl.textContent = `Error: ${error}`
  } finally {
    runTestsBtn.disabled = false
  }
})

if (window.location.search.includes('autorun')) {
  setTimeout(() => runTestsBtn.click(), 500)
}

statusEl.textContent = 'Ready'
