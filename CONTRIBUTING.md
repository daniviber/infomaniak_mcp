# Contributing to Infomaniak MCP Server

Thank you for your interest in contributing to the Infomaniak MCP Server! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates. When creating a bug report, include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Your environment (Node.js version, OS, etc.)
- Any relevant error messages or logs

### Suggesting Features

Feature suggestions are welcome! When suggesting a feature:

- Provide a clear description of the feature
- Explain the use case and why it would be valuable
- Consider if it aligns with the Infomaniak API capabilities

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following the coding style
4. **Build the project**: `npm run build`
5. **Test your changes** manually with the MCP Inspector: `npm run inspector`
6. **Update documentation** if needed
7. **Submit a pull request** with a clear description

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/infomaniak-mcp-server.git
cd infomaniak-mcp-server

# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run dev

# Test with MCP Inspector
INFOMANIAK_API_TOKEN=your-token npm run inspector
```

## Coding Guidelines

### TypeScript

- Use TypeScript strict mode
- Define proper types for all function parameters and return values
- Avoid using `any` type when possible
- Use meaningful variable and function names

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add trailing commas in multi-line arrays/objects
- Document public functions with JSDoc comments

### Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(dns): add support for CAA records`
- `fix(mail): handle empty mailbox list response`
- `docs: update installation instructions`

## Adding New Tools

When adding new tools to the MCP server:

1. **Add the API method** in `src/infomaniak-client.ts`:
   ```typescript
   async newMethod(param: string): Promise<ApiResponse<ResultType>> {
     return this.request<ApiResponse<ResultType>>('GET', `/1/endpoint/${param}`);
   }
   ```

2. **Define the tool** in `src/index.ts` tools array:
   ```typescript
   {
     name: "infomaniak_new_tool",
     description: "Clear description of what this tool does",
     inputSchema: {
       type: "object",
       properties: {
         param: {
           type: "string",
           description: "Description of the parameter",
         },
       },
       required: ["param"],
     },
   },
   ```

3. **Add the handler** in the switch statement:
   ```typescript
   case "infomaniak_new_tool":
     result = await client.newMethod(args?.param as string);
     break;
   ```

4. **Update README.md** with the new tool documentation

## Testing

Currently, the project uses manual testing with the MCP Inspector. When testing:

1. Set your `INFOMANIAK_API_TOKEN` environment variable
2. Run `npm run inspector`
3. Test each modified tool with various inputs
4. Verify error handling with invalid inputs

## Questions?

Feel free to open an issue for any questions about contributing.

Thank you for contributing! 🎉
