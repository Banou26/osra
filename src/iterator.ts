// import type { ApiResolverOptions } from '..'

// export default
//   func =>
//     async ({ port, ...rest }: ApiResolverOptions) => {
//       port.start()
//       for await (const value of func({ port, ...rest })) {
//         if (Array.isArray(value)) {
//           port.postMessage(value[0], <Transferable[]>value[1])
//         } else {
//           port.postMessage(value)
//         }
//       }
//       port.close()
//     }
