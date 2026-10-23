const path = require('path');
const fs = require('fs');

const {Compilation} = require('webpack');

const PLUGIN_ID = require('../plugin.json').id;

// Mattermost 12.0 still assigns these on window. It does not assign
// mattermost-redux, so that package must stay external and unused.

// The webapp bundle carries the dictionaries itself (imported in i18n.js),
// but the platform convention also keeps a copy at webapp/dist/i18n so the
// plugin follows the standard layout.
class CopyI18n {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('CopyI18n', (compilation) => {
            compilation.hooks.processAssets.tap(
                {name: 'CopyI18n', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL},
                () => {
                    ['en.json', 'ru.json'].forEach((file) => {
                        const source = fs.readFileSync(path.join(__dirname, 'i18n', file));
                        compilation.emitAsset(path.posix.join('i18n', file), new compiler.webpack.sources.RawSource(source));
                    });
                },
            );
        });
    }
}

module.exports = {
    entry: ['./src/index.js'],
    resolve: {
        modules: ['src', 'node_modules'],
        extensions: ['.js', '.jsx'],
    },
    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: {loader: 'babel-loader'},
            },
        ],
    },
    plugins: [
        new CopyI18n(),
    ],
    externals: [
        {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react-intl': 'ReactIntl',
            redux: 'Redux',
            'react-redux': 'ReactRedux',
            'prop-types': 'PropTypes',
            'react-bootstrap': 'ReactBootstrap',
            'react-router-dom': 'ReactRouterDom',
        },
        ({request}, callback) => {
            if (request === 'mattermost-redux' || (request && request.startsWith('mattermost-redux/'))) {
                return callback(null, 'root "mattermost-redux"');
            }
            return callback();
        },
    ],
    output: {
        devtoolNamespace: PLUGIN_ID,
        path: path.join(__dirname, '/dist'),
        publicPath: '/',
        filename: 'main.js',
    },
    mode: 'production',
};
