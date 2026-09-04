const path = require('path');
const webpack = require('webpack');
const dotenv = require('dotenv');
const HtmlWebpackPlugin = require('html-webpack-plugin');

dotenv.config({ path: path.resolve(__dirname, '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.tsx',
    output: {
      publicPath: 'auto',
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: 'babel-loader',
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    devServer: {
      port: 3015,
      allowedHosts: 'all',
      // HMR 客户端从页面自身 location 推导 WS 地址，避免内部端口拼到网关域名后
      client: {
        webSocketURL: 'auto://0.0.0.0:0/ws',
      },
      historyApiFallback: {
        index: '/index.html',
        rewrites: [{ from: /^\/_p\/\d+\//, to: '/index.html' }],
      },
      proxy: [
        {
          context: ['/api'],
          target: 'http://localhost:3020',
          changeOrigin: true,
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.APP_DATA_MODE': JSON.stringify(process.env.APP_DATA_MODE || 'mock'),
        'process.env.APP_SUPABASE_URL': JSON.stringify(process.env.APP_SUPABASE_URL || ''),
        'process.env.APP_SUPABASE_ANON_KEY': JSON.stringify(process.env.APP_SUPABASE_ANON_KEY || ''),
      }),
      new HtmlWebpackPlugin({
        template: './index.html',
        filename: isDev ? 'index.html' : path.join(__dirname, 'bundle.html'),
        inject: 'body',
      }),
    ],
    externals: {
      '@ali/oneday-frontend-sdk': 'var (typeof oneday !== "undefined" ? oneday : { createClient: function() { return null; } })',
    },
  };
};
