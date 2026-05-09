import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { credentialSecretDisplay } from "@/lib/credential-display";
import type { CredentialRef } from "@/lib/types";
import { CREDENTIAL_SOURCE_OPTIONS } from "./constants";
import {
  blankCredential,
  DEFAULT_KEYCHAIN_SERVICE,
  fileCredentialValue,
} from "./settings-utils";

export function CredentialEditor({
  credential,
  onChange,
  placeholder,
  ariaLabel,
  invalid,
}: {
  credential?: CredentialRef | null;
  onChange: (credential: CredentialRef | null) => void;
  placeholder?: string;
  ariaLabel: string;
  invalid?: boolean;
}) {
  const source = credential?.source ?? "file";
  const secretDisplay = credentialSecretDisplay(credential);
  const changeSource = (nextSource: CredentialRef["source"]) => {
    onChange(blankCredential(nextSource, credential));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[132px_minmax(0,1fr)]">
      <GlassSelect
        value={source}
        onValueChange={(value) =>
          changeSource(value as CredentialRef["source"])
        }
        options={CREDENTIAL_SOURCE_OPTIONS}
        size="sm"
        ariaLabel={`${ariaLabel} 来源`}
      />
      {source === "file" && (
        <Input
          value={fileCredentialValue(credential)}
          onChange={(event) =>
            onChange({ source: "file", value: event.target.value })
          }
          placeholder={
            secretDisplay ? `${secretDisplay}，留空保留` : placeholder
          }
          size="sm"
          monospace
          aria-label={ariaLabel}
          aria-invalid={invalid}
        />
      )}
      {source === "env" && (
        <Input
          value={credential?.source === "env" ? credential.env : ""}
          onChange={(event) =>
            onChange({ source: "env", env: event.target.value })
          }
          placeholder="如 OPENAI_API_KEY"
          size="sm"
          monospace
          aria-label={ariaLabel}
          aria-invalid={invalid}
        />
      )}
      {source === "keychain" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={
              credential?.source === "keychain"
                ? (credential.service ?? "")
                : ""
            }
            onChange={(event) =>
              onChange({
                source: "keychain",
                service: event.target.value,
                account:
                  credential?.source === "keychain" ? credential.account : "",
              })
            }
            placeholder="service"
            size="sm"
            monospace
            aria-label={`${ariaLabel} Keychain service`}
            aria-invalid={invalid}
          />
          <Input
            value={credential?.source === "keychain" ? credential.account : ""}
            onChange={(event) =>
              onChange({
                source: "keychain",
                service:
                  credential?.source === "keychain"
                    ? credential.service
                    : DEFAULT_KEYCHAIN_SERVICE,
                account: event.target.value,
              })
            }
            placeholder="account"
            size="sm"
            monospace
            aria-label={`${ariaLabel} Keychain account`}
            aria-invalid={invalid}
          />
        </div>
      )}
    </div>
  );
}
