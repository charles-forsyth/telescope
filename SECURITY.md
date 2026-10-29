# Security policy

Please report a vulnerability privately with GitHub's **Report a vulnerability** button on the Security tab of this repository, not in a public issue. I aim to reply within a week.

Telescope is read-only: it signs in with OAuth 2.1 + PKCE, keeps tokens in the macOS keychain, and only calls the Skywalker MCP server's read tools.
