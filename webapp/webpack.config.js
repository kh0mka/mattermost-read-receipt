const path = require('path');

const PLUGIN_ID = require('../plugin.json').id;

// Mattermost 11.11 assigns these on window in the webapp chunk. It does not
// assign mattermost-redux, so that package must stay external and unused.
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
    externals: [
        {
            react: 'React',
            'react-dom': 'ReactDOM',
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
