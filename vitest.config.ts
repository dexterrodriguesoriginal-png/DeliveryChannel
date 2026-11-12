import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.mts';

export default defineConfig(async env => mergeConfig(await viteConfig(env), {
  test: {
    environmentOptions: {
      happyDOM: {
        settings: {
          // Happy DOM 21 disables iframe loading and emits errors on insertion.
          // Keep real iframe elements/contentWindow for preview bridge tests,
          // but never navigate or fetch embedded apps/YouTube in unit tests.
          enableIframePageLoading: true,
          navigation: { disableChildFrameNavigation: true },
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
}));
