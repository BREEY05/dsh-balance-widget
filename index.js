/**
 * Host half of the API balance widget bundle.
 *
 * All balance reading and rendering happens in the Client half: the browser calls the
 * existing authenticated `remote.account` namespace, which forwards the read to
 * `deepseekAccount.getBalance()` in the Host process. This half therefore registers
 * nothing; it exists so the bundle has a Loader entry whose package carries `dsh.client`.
 */
export function apply() {}
