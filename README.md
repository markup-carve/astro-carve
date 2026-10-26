# astro-carve

Astro integration for `.crv` pages and imports, using @markup-carve/carve 0.1.14 or later. Documents render during the site build. Read the [Carve documentation](https://markup-carve.github.io/carve/) for the language syntax.

## Install

```sh
npm install @markup-carve/astro-carve
```

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
