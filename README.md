# astro-carve

Astro integration for Carve 0.2 `.crv` pages and imports. Documents render during the site build. Read the [Carve 0.2 specification](https://github.com/markup-carve/carve/tree/main/spec/0.2) for the language syntax.

## Install

```sh
npm install @markup-carve/astro-carve@^0.2
```

This needs Node.js 20 or newer.

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
