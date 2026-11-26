# astro-carve

Astro integration for Carve 0.2 `.crv` pages and imports. The `main` branch uses an unreleased carve-js commit and is not a registry release. Documents render during the site build. Read the [Carve 0.2 specification](https://github.com/markup-carve/carve/tree/main/spec/0.2) for the language syntax.

## Install

```sh
npm install github:markup-carve/astro-carve
```

The engine builds during installation, so this needs Git and Node.js 20 or newer.

## Usage

```js
import carve from '@markup-carve/astro-carve'

export default { integrations: [carve()] }
```

## Documentation

- [Carve documentation](https://markup-carve.github.io/carve/)
- [Documentation index](docs/README.md)

## License

[MIT](LICENSE)
