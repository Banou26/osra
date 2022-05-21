import { registerListener } from '../../src/register'
import { makeCallListener } from '../../src/call'

const resolvers = {
  'CALL': makeCallListener((data, extra) => {
    return 1
  }),
  'THROW': makeCallListener((data, extra) => {
    throw new Error('error message')
  }),
}

export type Resolvers = typeof resolvers

registerListener({
  target: window,
  resolvers
})
