import type { SocialProviders } from "better-auth";

type OAuthProviderDefinition = {
	id: string;
	name: string;
	clientIdEnv: string;
	clientSecretEnv: string;
};

const providerDefinitions: readonly OAuthProviderDefinition[] = [
	{
		id: "google",
		name: "Google",
		clientIdEnv: "GOOGLE_CLIENT_ID",
		clientSecretEnv: "GOOGLE_CLIENT_SECRET",
	},
	{
		id: "github",
		name: "GitHub",
		clientIdEnv: "GITHUB_CLIENT_ID",
		clientSecretEnv: "GITHUB_CLIENT_SECRET",
	},
];

export type PublicOAuthProvider = { id: string; name: string };
export type OAuthEnvironment = Readonly<Record<string, unknown>>;

function readEnvValue(env: OAuthEnvironment, key: string) {
	const raw = env[key];
	return typeof raw === "string" ? raw : undefined;
}

export function configureOAuthProviders(env: OAuthEnvironment) {
	const configured: Record<string, Record<string, unknown>> = {};
	const publicProviders: PublicOAuthProvider[] = [];

	for (const definition of providerDefinitions) {
		const rawClientId = readEnvValue(env, definition.clientIdEnv);
		const rawClientSecret = readEnvValue(env, definition.clientSecretEnv);
		const clientId = rawClientId?.trim();
		const clientSecret = rawClientSecret?.trim() ? rawClientSecret : undefined;
		if (!clientId && !clientSecret) continue;
		if (!clientId || !clientSecret) {
			throw new Error(
				`Configure both ${definition.clientIdEnv} and ${definition.clientSecretEnv} to enable ${definition.name}`,
			);
		}

		const providerConfig: Record<string, unknown> = {
			clientId,
			clientSecret,
		};
		if (definition.id === "google") providerConfig.prompt = "select_account";

		configured[definition.id] = providerConfig;
		publicProviders.push({ id: definition.id, name: definition.name });
	}

	return {
		// Keys are restricted to the explicit built-in provider registry above.
		socialProviders: configured as unknown as SocialProviders,
		providers: publicProviders,
	};
}
