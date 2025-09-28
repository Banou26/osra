import type { Context } from './context'
import type {
  StructuredCloneTransferableProxiable,
  MessagePortProxy,
  Revivable,
  FunctionProxy
} from '../types'

import { OSRA_PROXY } from '../types'

const isProxy = (value: StructuredCloneTransferableProxiable): value is Revivable =>
  Boolean(
    value
    && typeof value === 'object'
    && OSRA_PROXY in value
  )

const isMessagePortProxy = (value: StructuredCloneTransferableProxiable): value is MessagePortProxy =>
  isProxy(value) && value.type === 'messagePort'

export const replaceMessagePort = (value: MessagePort, context: Context): MessagePortProxy => {

}

export const reviveMessagePort = (value: MessagePortProxy, context: Context): MessagePort => {

}

const isFunctionProxy = (value: StructuredCloneTransferableProxiable): value is FunctionProxy =>
  isProxy(value) && value.type === 'function'

export const replaceFunction = (value: Function, context: Context): FunctionProxy => {

}

export const reviveFunction = (value: FunctionProxy, context: Context): Function => {

}

export const replaceAll = (value: StructuredCloneTransferableProxiable, context: Context) =>
  value instanceof MessagePort ? replaceMessagePort(value, context)
  : typeof value === 'function' ? replaceFunction(value, context)
  : value

export const reviveAll = (value: StructuredCloneTransferableProxiable, context: Context) =>
  isMessagePortProxy(value) ? reviveMessagePort(value, context)
  : isFunctionProxy(value) ? reviveFunction(value, context)
  : value
