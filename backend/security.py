"""Read-only security configuration check: python -m backend.security [--json].

Reports known boundaries and unresolved release blockers. This is not a network
probe, vulnerability scanner, or certificate that a deployment is safe.
"""
import argparse
import json
import os

from backend.services.exposure import allowed_hosts, is_loopback, validate_bind_host


def inspect_security(host: str | None = None) -> dict:
    bind = host or os.environ.get('ARYNWOOD_BIND_HOST', '127.0.0.1')
    checks = []

    def add(identifier, severity, message, remedy=''):
        checks.append({'id': identifier, 'severity': severity, 'message': message, 'remedy': remedy})

    try:
        validate_bind_host(bind)
    except RuntimeError:
        add('network.remote_auth', 'error', 'Non-loopback binding has no API key.', 'Keep loopback binding or configure an owner API key.')
    else:
        add('network.remote_auth', 'pass', 'Loopback binding or authenticated remote configuration.')
    add('auth.owner_key', 'pass' if os.environ.get('ARYNWOOD_API_KEY', '').strip() else 'info',
        'Owner API key configured.' if os.environ.get('ARYNWOOD_API_KEY', '').strip() else 'No API key: local processes have owner access.',
        'Keep the app single-owner and local until the desktop authentication flow is implemented.')
    try:
        allowed_hosts()
    except RuntimeError:
        add('network.host_policy', 'error', 'Invalid Host allowlist configuration.', 'Use exact hostnames or IPs; remote entries require an API key.')
    else:
        add('network.host_policy', 'pass', 'Exact Host validation configured; no wildcard entries.')
    if not is_loopback(bind):
        add('network.remote_transport', 'warning', 'A key does not provide transport encryption or tenant isolation.', 'Keep testing local; review TLS and proxy trust before enabling remote clients.')
    if os.environ.get('ARYNWOOD_ENABLE_CODEBASE_TOOLS') == '1':
        add('tools.codebase_enabled', 'warning', 'Developer tools can read and execute repository code.', 'Disable ARYNWOOD_ENABLE_CODEBASE_TOOLS for non-developer installations.')
    else:
        add('tools.codebase_enabled', 'pass', 'Developer codebase tools are disabled.')
    if os.environ.get('ARYNWOOD_ENABLE_AUTO_PUBLISH') == '1':
        add('publishing.unattended_enabled', 'warning', 'The launcher may start unattended YouTube publishing.', 'Unset ARYNWOOD_ENABLE_AUTO_PUBLISH and review artifacts manually during private hardening.')
    else:
        add('publishing.unattended_enabled', 'pass', 'Launcher unattended publishing is disabled.')
    add('tools.execution_isolation', 'warning', 'Tool execution is not contained by an OS sandbox.', 'Implement and adversarially test filesystem, network, and credential isolation before a hardened release.')
    add('tools.mcp_dispatch_policy', 'pass', 'MCP agent, proxy and codebase RPC calls share tier and approval enforcement.')
    add('tools.direct_api_policy', 'warning', 'Studio, deployment, social and other owner action APIs are not covered by MCP approval grants.', 'Extend shared execution policy to the remaining action routes before release.')
    add('privacy.offline_enforcement', 'warning', 'Local defaults do not enforce an offline guarantee.', 'Implement a shared egress policy and verify it with network-observed tests.')
    return {'release_ready': False, 'scope': 'configuration and known source limitations; no active probes', 'checks': checks}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--json', action='store_true', help='Print structured checks without credentials')
    parser.add_argument('--strict', action='store_true', help='Fail on known warnings as well as errors')
    parser.add_argument('--host', help='Evaluate a specific listener, such as the gateway --host value')
    args = parser.parse_args(argv)
    # Same source/packaged data location as the backend. Load as data, never shell
    # source a configuration file. Existing process environment takes precedence.
    from dotenv import dotenv_values
    from backend._frozen import user_data_dir
    for key, value in dotenv_values(os.path.join(user_data_dir(), '.env')).items():
        if value is not None:
            os.environ.setdefault(key, value)
    report = inspect_security(args.host)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print('Private hardening phase: release gates remain open.')
        for check in report['checks']:
            print(f"{check['severity'].upper()} {check['id']}: {check['message']}")
            if check['remedy'] and check['severity'] != 'pass':
                print(f"  {check['remedy']}")
    failures = {'error', 'warning'} if args.strict else {'error'}
    return int(any(check['severity'] in failures for check in report['checks']))


if __name__ == '__main__':
    raise SystemExit(main())
