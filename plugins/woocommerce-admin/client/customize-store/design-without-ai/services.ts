/**
 * External dependencies
 */
import { Sender } from 'xstate';
import { recordEvent } from '@woocommerce/tracks';
import apiFetch from '@wordpress/api-fetch';
import { resolveSelect, dispatch } from '@wordpress/data';
// @ts-expect-error -- No types for this exist yet.
// eslint-disable-next-line @woocommerce/dependency-group
import { mergeBaseAndUserConfigs } from '@wordpress/edit-site/build-module/components/global-styles/global-styles-provider';
// @ts-expect-error -- No types for this exist yet.
// eslint-disable-next-line @woocommerce/dependency-group
import { store as coreStore } from '@wordpress/core-data';

/**
 * Internal dependencies
 */
import { updateTemplate } from '../data/actions';
import { HOMEPAGE_TEMPLATES } from '../data/homepageTemplates';
import { installAndActivateTheme as setTheme } from '../data/service';
import { THEME_SLUG } from '../data/constants';
import { FontFace, FontFamily } from '../types/font';
import {
	FontCollectionResponse,
	installFontFace,
	installFontFamily,
	getFontFamiliesAndFontFaceToInstall,
} from './fonts';
import { COLOR_PALETTES } from '../assembler-hub/sidebar/global-styles/color-palette-variations/constants';
import { FONT_PAIRINGS_WHEN_AI_IS_OFFLINE } from '../assembler-hub/sidebar/global-styles/font-pairing-variations/constants';

const assembleSite = async () => {
	await updateTemplate( {
		homepageTemplateId: 'template1' as keyof typeof HOMEPAGE_TEMPLATES,
	} );
};

const browserPopstateHandler =
	() => ( sendBack: Sender< { type: 'EXTERNAL_URL_UPDATE' } > ) => {
		const popstateHandler = () => {
			sendBack( { type: 'EXTERNAL_URL_UPDATE' } );
		};
		window.addEventListener( 'popstate', popstateHandler );
		return () => {
			window.removeEventListener( 'popstate', popstateHandler );
		};
	};

const installAndActivateTheme = async () => {
	try {
		await setTheme( THEME_SLUG );
	} catch ( error ) {
		recordEvent(
			'customize_your_store__no_ai_install_and_activate_theme_error',
			{
				theme: THEME_SLUG,
				error: error instanceof Error ? error.message : 'unknown',
			}
		);
		throw error;
	}
};

const installFontFamilies = async () => {
	const isTrackingEnabled = window.wcTracks?.isEnabled || false;
	if ( ! isTrackingEnabled ) {
		return;
	}

	try {
		const installedFontFamily = ( await resolveSelect(
			'core'
		).getEntityRecords( 'postType', 'wp_font_family', {
			per_page: -1,
		} ) ) as Array< {
			id: number;
			font_faces: Array< number >;
			font_family_settings: FontFamily;
		} >;

		const installedFontFamiliesWithFontFaces = await Promise.all(
			installedFontFamily.map( async ( fontFamily ) => {
				const fontFaces = await apiFetch< Array< FontFace > >( {
					path: `/wp/v2/font-families/${ fontFamily.id }/font-faces`,
					method: 'GET',
				} );

				return {
					...fontFamily,
					font_face: fontFaces,
				};
			} )
		);

		const fontCollection = await apiFetch< FontCollectionResponse >( {
			path: `/wp/v2/font-collections/google-fonts`,
			method: 'GET',
		} );

		const { fontFacesToInstall, fontFamiliesWithFontFacesToInstall } =
			getFontFamiliesAndFontFaceToInstall(
				fontCollection,
				installedFontFamiliesWithFontFaces
			);

		const fontFamiliesWithFontFaceToInstallPromises =
			fontFamiliesWithFontFacesToInstall.map( async ( fontFamily ) => {
				const fontFamilyResponse = await installFontFamily(
					fontFamily
				);
				return Promise.all(
					fontFamily.fontFace.map( async ( fontFace, index ) => {
						installFontFace(
							{
								...fontFace,
								fontFamilyId: fontFamilyResponse.id,
							},
							index
						);
					} )
				);
			} );

		const fontFacesToInstallPromises =
			fontFacesToInstall.map( installFontFace );

		await Promise.all( [
			...fontFamiliesWithFontFaceToInstallPromises,
			...fontFacesToInstallPromises,
		] );
	} catch ( error ) {
		throw error;
	}
};

const createProducts = async () => {
	try {
		const { success } = await apiFetch< {
			success: boolean;
		} >( {
			path: `/wc-admin/onboarding/products`,
			method: 'POST',
		} );

		if ( ! success ) {
			throw new Error( 'Product creation failed' );
		}
	} catch ( error ) {
		throw error;
	}
};

const updateGlobalStylesWithDefaultValues = async () => {
	// We are using the first color palette and font pairing that are displayed on the color/font picker on the sidebar.
	const colorPalette = COLOR_PALETTES[ 0 ];
	const fontPairing = FONT_PAIRINGS_WHEN_AI_IS_OFFLINE[ 0 ];

	// @ts-expect-error No types for this exist yet.
	const { invalidateResolutionForStoreSelector } = dispatch( coreStore );
	invalidateResolutionForStoreSelector(
		'__experimentalGetCurrentGlobalStylesId'
	);

	const globalStylesId = await resolveSelect(
		coreStore
		// @ts-expect-error No types for this exist yet.
	).__experimentalGetCurrentGlobalStylesId();

	// @ts-expect-error No types for this exist yet.
	const { saveEntityRecord } = dispatch( coreStore );

	await saveEntityRecord(
		'root',
		'globalStyles',
		{
			id: globalStylesId,
			styles: mergeBaseAndUserConfigs(
				colorPalette?.styles || {},
				fontPairing?.styles || {}
			),
			settings: mergeBaseAndUserConfigs(
				colorPalette?.settings || {},
				fontPairing?.settings || {}
			),
		},
		{
			throwOnError: true,
		}
	);
};

export const services = {
	assembleSite,
	browserPopstateHandler,
	installAndActivateTheme,
	createProducts,
	installFontFamilies,
	updateGlobalStylesWithDefaultValues,
};
