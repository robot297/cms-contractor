<script lang="ts">
	import { tick, onDestroy } from 'svelte';
	import { deserialize } from '$app/forms';
	import {
		parseAamva,
		scanReviewFacts,
		scanToSubcontractorFields,
		type ScannedId,
		type SubcontractorScanFields
	} from '$lib/id-scan';
	// Served from our own bundle rather than the library's default CDN, so the
	// decoder works behind a firewall and on a locked-down CSP.
	import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

	/**
	 * ID Scan — point the camera at a subcontractor's ID and fill the form.
	 *
	 * Two paths, in order of preference. The PDF417 on the back of any US or
	 * Canadian licence decodes here in the browser: exact fields, nothing
	 * transmitted, no cost, works with the phone in airplane mode. A card with no
	 * barcode — a trade licence, a foreign ID — can be sent to the server to be
	 * read instead, but only when the contractor asks for it and only when the
	 * deployment has a provider configured.
	 *
	 * Nothing here saves anything. A scan ends by handing field values to the
	 * form, which the contractor reviews and submits like any typed entry.
	 */

	let {
		visionConfigured = false,
		devTools = false,
		onapply,
		onclose
	}: {
		/** Whether this deployment can read a card that has no barcode. */
		visionConfigured?: boolean;
		devTools?: boolean;
		onapply: (fields: SubcontractorScanFields) => void;
		onclose: () => void;
	} = $props();

	type Stage = 'choose' | 'camera' | 'reading' | 'confirm';
	let stage = $state<Stage>('choose');
	let error = $state('');
	/** Progress the contractor should see while the decode loop is running. */
	let hint = $state('');
	let scan = $state<ScannedId | null>(null);

	/** The editable copy of what the scan proposes. Blank fields aren't applied. */
	let draft = $state({ name: '', address: '', licenseNumber: '', licenseExpiresAt: '' });

	let video: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | undefined;
	let frame: HTMLCanvasElement | undefined;
	let decodeTimer: ReturnType<typeof setInterval> | undefined;
	let decoding = false;
	/** How many frames have gone by with no barcode, so the UI can offer a way out. */
	let emptyFrames = $state(0);

	const facts = $derived(scan ? scanReviewFacts(scan) : []);
	/** Only a trade licence fills the licence number — see id-scan.ts. */
	const showLicense = $derived(scan?.documentType === 'trade-license');

	// ---------------------------------------------------------------- decoding

	/**
	 * Hoisted so its identity is stable. The library caches its instantiated
	 * module against the overrides object by shallow equality, so a fresh
	 * `locateFile` closure per call would rebuild the wasm module on every frame
	 * of the decode loop.
	 */
	const WASM_OVERRIDES = {
		locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path)
	};

	let readerModule: Promise<typeof import('zxing-wasm/reader')> | undefined;

	/** Load the decoder on demand — it costs nothing on any page that never scans. */
	function decoder() {
		readerModule ??= import('zxing-wasm/reader').then((reader) => {
			reader.prepareZXingModule({ overrides: WASM_OVERRIDES });
			return reader;
		});
		return readerModule;
	}

	/** Draw the current video frame at `maxEdge` and hand back the canvas. */
	function grabFrame(maxEdge: number): HTMLCanvasElement | null {
		if (!video?.videoWidth) return null;
		const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
		frame ??= document.createElement('canvas');
		frame.width = Math.round(video.videoWidth * scale);
		frame.height = Math.round(video.videoHeight * scale);
		const ctx = frame.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(video, 0, 0, frame.width, frame.height);
		return frame;
	}

	/** Try the current frame. Returns a scan only when a real ID comes back. */
	async function decodeCurrentFrame(): Promise<ScannedId | null> {
		// A licence barcode is dense; decoding a downscaled frame loses it, so the
		// frame goes in near full size and the interval keeps the cost bounded.
		const canvas = grabFrame(1920);
		if (!canvas) return null;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		return decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
	}

	async function decodeImageData(input: ImageData | Blob): Promise<ScannedId | null> {
		const { readBarcodes } = await decoder();
		const results = await readBarcodes(input, { formats: ['PDF417'], tryHarder: true });
		for (const result of results) {
			if (!result.isValid) continue;
			// A PDF417 that isn't an AAMVA payload is somebody's shipping label.
			const parsed = parseAamva(result.text);
			if (parsed) return parsed;
		}
		return null;
	}

	function startDecodeLoop() {
		stopDecodeLoop();
		decodeTimer = setInterval(async () => {
			if (decoding || stage !== 'camera') return;
			decoding = true;
			try {
				const found = await decodeCurrentFrame();
				if (found) {
					enterConfirm(found);
					return;
				}
				emptyFrames += 1;
				if (emptyFrames === 6)
					hint = 'Still looking — hold the barcode side flat and fill the frame.';
			} catch {
				// A frame that won't decode is the normal case, not an error. Only a
				// decoder that never loads is worth reporting, and that surfaces on
				// the first call below.
			} finally {
				decoding = false;
			}
		}, 400);
	}

	function stopDecodeLoop() {
		if (decodeTimer) clearInterval(decodeTimer);
		decodeTimer = undefined;
	}

	// ------------------------------------------------------------------ camera

	async function startCamera() {
		error = '';
		hint = 'Point at the barcode on the back of the card.';
		emptyFrames = 0;
		stage = 'camera';
		if (!navigator.mediaDevices?.getUserMedia) {
			error = 'This device has no camera access. Upload a photo of the card instead.';
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				// A licence barcode needs resolution; asking for it is a hint, not a
				// demand, so a webcam that can't oblige still works.
				video: { facingMode: 'environment', width: { ideal: 1920 } },
				audio: false
			});
			await tick();
			if (video) video.srcObject = stream;
			// Confirm the decoder loads before promising the contractor anything.
			await decoder();
			startDecodeLoop();
		} catch {
			error = 'Camera permission was denied or unavailable. Upload a photo instead.';
		}
	}

	function stopCamera() {
		stopDecodeLoop();
		stream?.getTracks().forEach((t) => t.stop());
		stream = undefined;
		if (video) video.srcObject = null;
	}

	// ------------------------------------------------------------- vision path

	/**
	 * Send the current frame to be read. Explicitly a second choice: the image
	 * leaves the device here, which the barcode path never does, so it only
	 * happens when the contractor presses the button.
	 */
	async function readWithVision(dataUrl: string) {
		stopCamera();
		stage = 'reading';
		error = '';
		try {
			const body = new FormData();
			body.set('image', dataUrl);
			const res = await fetch('?/scanId', {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data?.scan) {
				enterConfirm(result.data.scan as ScannedId);
				return;
			}
			const reason = result.type === 'failure' ? result.data?.reason : undefined;
			error =
				reason === 'unconfigured'
					? 'Reading a card is not set up on this deployment. Scan the barcode on the back instead.'
					: reason === 'unreadable'
						? "That didn't come out as a readable ID. Try again with more light and the card filling the frame."
						: reason === 'invalid'
							? 'That photo could not be used. Try again.'
							: 'The card could not be read just now. Try again, or type the details in.';
			stage = 'choose';
		} catch {
			error = 'The card could not be read just now. Try again, or type the details in.';
			stage = 'choose';
		}
	}

	function readCurrentFrameWithVision() {
		const canvas = grabFrame(1600);
		if (!canvas) {
			error = 'Nothing to read yet — give the camera a moment.';
			return;
		}
		void readWithVision(canvas.toDataURL('image/jpeg', 0.85));
	}

	// ------------------------------------------------------- file (desktop path)

	async function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		stopCamera();
		error = '';
		stage = 'reading';
		try {
			const found = await decodeImageData(file);
			if (found) {
				enterConfirm(found);
				return;
			}
		} catch {
			// Fall through to vision, or to the message below.
		}
		if (visionConfigured) {
			void readWithVision(await fileToDataUrl(file));
			return;
		}
		error = 'No ID barcode found in that photo.';
		stage = 'choose';
	}

	function fileToDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error('Could not read that file'));
			reader.readAsDataURL(file);
		});
	}

	// ----------------------------------------------------------------- confirm

	function enterConfirm(found: ScannedId) {
		stopCamera();
		scan = found;
		const fields = scanToSubcontractorFields(found);
		draft = {
			name: fields.name ?? '',
			address: fields.address ?? '',
			licenseNumber: fields.licenseNumber ?? '',
			licenseExpiresAt: fields.licenseExpiresAt ?? ''
		};
		error = '';
		hint = '';
		stage = 'confirm';
	}

	function apply() {
		onapply({
			name: draft.name.trim() || null,
			address: draft.address.trim() || null,
			licenseNumber: draft.licenseNumber.trim() || null,
			licenseExpiresAt: draft.licenseExpiresAt.trim() || null
		});
		close();
	}

	function close() {
		stopCamera();
		// The frame is the ID. Nothing keeps a reference to it past this point.
		frame = undefined;
		scan = null;
		onclose();
	}

	onDestroy(stopCamera);

	// --------------------------------------------------------------- dev tools

	/**
	 * A real AAMVA payload, run through the real parser and the real confirm step
	 * — so the whole feature can be exercised with no camera and no card. Behind
	 * ID_SCAN_DEV_TOOLS, which must never be on in production.
	 */
	const FIXTURE_BARCODE =
		'@\n\rANSI 636000100002DL00410279ZV03190008DLDAQT64235789\nDCSSAMPLE\nDACMICHAEL\nDADJOHN\nDBB06061986\nDBA12102025\nDAG2300 WEST BROAD STREET\nDAIRICHMOND\nDAJVA\nDAK232690000\nDCGUSA\n\r';

	const FIXTURE_TRADE_LICENCE: ScannedId = {
		source: 'vision',
		documentType: 'trade-license',
		firstName: 'Jordan',
		middleName: null,
		lastName: 'Rivera',
		suffix: null,
		street: '14 Foundry Row',
		city: 'Austin',
		state: 'TX',
		postalCode: '78701',
		address: '14 Foundry Row, Austin, TX 78701',
		idNumber: 'EC-100420',
		dateOfBirth: null,
		expiresAt: '2027-04-30',
		issuer: 'Texas Department of Licensing'
	};

	function runFixtureBarcode() {
		const parsed = parseAamva(FIXTURE_BARCODE);
		if (parsed) enterConfirm(parsed);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="Scan an ID" tabindex="-1">
		<header class="head">
			<h2>{stage === 'confirm' ? 'Check what the card says' : 'Scan an ID'}</h2>
			<button type="button" class="close" aria-label="Close scanner" onclick={close}>✕</button>
		</header>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		{#if stage === 'choose'}
			<p class="lead">
				Point the camera at the barcode on the <strong>back</strong> of a driver's licence or state ID.
				It is read on this device — the photo never leaves it.
			</p>
			<div class="actions stack">
				<button type="button" class="btn primary" onclick={startCamera}>📷 Scan the barcode</button>
				<label class="btn">
					⬆ Upload a photo
					<input type="file" accept="image/*" onchange={onPick} />
				</label>
			</div>
			{#if !visionConfigured}
				<p class="note">
					Cards with no barcode — trade licences, foreign IDs — can't be read on this deployment.
					Type those in.
				</p>
			{/if}

			{#if devTools}
				<div class="devtools">
					<div class="devtools-head">Scan simulator</div>
					<p>
						<code>ID_SCAN_DEV_TOOLS</code> is on. These run the real parser and the real confirm step
						against fixtures — no camera, no card, no provider call.
					</p>
					<div class="actions">
						<button type="button" class="btn small" onclick={runFixtureBarcode}
							>Licence barcode</button
						>
						<button
							type="button"
							class="btn small"
							onclick={() => enterConfirm(FIXTURE_TRADE_LICENCE)}>Trade licence</button
						>
					</div>
				</div>
			{/if}
		{:else if stage === 'camera'}
			{#if !error}
				<div class="viewport">
					<video bind:this={video} autoplay playsinline muted></video>
					<div class="reticle" aria-hidden="true"></div>
				</div>
				<p class="hint" aria-live="polite">{hint}</p>
			{/if}
			<div class="actions">
				<button
					type="button"
					class="btn"
					onclick={() => {
						stopCamera();
						stage = 'choose';
					}}>← Back</button
				>
				{#if visionConfigured && !error}
					<button type="button" class="btn" onclick={readCurrentFrameWithVision}>
						No barcode? Read the card
					</button>
				{/if}
			</div>
			{#if visionConfigured && !error}
				<p class="note">Reading the card sends this photo to be read. The barcode never is.</p>
			{/if}
		{:else if stage === 'reading'}
			<p class="lead" aria-live="polite">Reading the card…</p>
			<div class="spinner" aria-hidden="true"></div>
		{:else if stage === 'confirm' && scan}
			<p class="lead">
				Read from the {scan.source === 'barcode' ? 'barcode' : 'card'}. Correct anything that's
				wrong, or clear a field to leave it alone.
			</p>

			<div class="fields">
				<label>
					<span>Name</span>
					<input bind:value={draft.name} />
				</label>
				<label>
					<span>Address</span>
					<input bind:value={draft.address} />
				</label>
				{#if showLicense}
					<label>
						<span>License #</span>
						<input bind:value={draft.licenseNumber} />
					</label>
					<label>
						<span>License expires</span>
						<input type="date" bind:value={draft.licenseExpiresAt} />
					</label>
				{/if}
			</div>

			{#if facts.length}
				<div class="dropped">
					<div class="dropped-head">Also on the card — shown, not saved</div>
					<dl>
						{#each facts as fact (fact.label)}
							<div class="fact">
								<dt>{fact.label}</dt>
								<dd>{fact.value}</dd>
							</div>
						{/each}
					</dl>
					<p class="note">
						These confirm the scan read the right card. They aren't stored, and neither is the
						photo.
					</p>
				</div>
			{/if}

			<div class="actions end">
				<button type="button" class="btn" onclick={close}>Discard</button>
				<button type="button" class="btn primary" onclick={apply}>Use these details</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Token-driven throughout: dark mode needs no override block of its own, and
	   there is nothing for a bare [data-theme='dark'] rule to fight with. */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(20, 23, 28, 0.55);
	}
	.sheet {
		width: min(30rem, 100%);
		max-height: 90vh;
		overflow-y: auto;
		display: grid;
		gap: 0.85rem;
		padding: 1.1rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--surface);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.head h2 {
		margin: 0;
		font-size: 1.05rem;
		text-transform: none;
	}
	.close {
		border: none;
		background: none;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		color: var(--fg-muted);
		padding: 0.2rem;
		border-radius: 6px;
	}
	.lead {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.45;
		color: var(--fg-muted);
	}
	.note {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.4;
		color: var(--fg-muted);
	}
	.hint {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--fg-muted);
		min-height: 1.2em;
	}
	.error {
		margin: 0;
		padding: 0.5rem 0.7rem;
		border: 1px solid #e5534b;
		border-radius: 10px;
		background: #ffebe9;
		color: #cf222e;
		font-size: 0.82rem;
		font-weight: 600;
	}

	/* The camera frame. 4:3 so the reticle matches how a card is held. */
	.viewport {
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		background: #000;
		aspect-ratio: 4 / 3;
	}
	.viewport video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	/* A guide, not a crop: the whole frame is decoded, but a contractor who fills
	   this rectangle with the barcode gets a hit far sooner. */
	.reticle {
		position: absolute;
		inset: 18% 8%;
		border: 2px dashed var(--brand);
		border-radius: 10px;
		pointer-events: none;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.actions.stack {
		flex-direction: column;
	}
	.actions.end {
		justify-content: flex-end;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface-sunken);
		color: inherit;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
	}
	.btn:hover {
		border-color: var(--fg-muted);
	}
	.btn.primary {
		background: var(--brand);
		border-color: var(--brand-deep);
		color: var(--on-brand);
	}
	.btn.small {
		padding: 0.4rem 0.7rem;
		font-size: 0.78rem;
	}
	.btn input[type='file'] {
		display: none;
	}

	.fields {
		display: grid;
		gap: 0.6rem;
	}
	.fields label {
		display: grid;
		gap: 0.25rem;
	}
	.fields span {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--fg-muted);
	}
	.fields input {
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--field-border, var(--line-strong));
		border-radius: 9px;
		background: var(--field-bg);
		color: inherit;
		font: inherit;
		font-size: 0.95rem;
	}
	.fields input:focus {
		outline: none;
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
		background: var(--field-bg-focus);
	}

	/* The fields the scan read and is about to throw away. Visually a panel, not
	   a form, so there's no suggestion they're going anywhere. */
	.dropped {
		display: grid;
		gap: 0.45rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	.dropped-head {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--fg-muted);
	}
	.dropped dl {
		margin: 0;
		display: grid;
		gap: 0.2rem;
	}
	.fact {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.85rem;
	}
	.fact dt {
		color: var(--fg-muted);
		font-weight: 600;
	}
	.fact dd {
		margin: 0;
		font-weight: 700;
	}

	.devtools {
		display: grid;
		gap: 0.4rem;
		padding: 0.6rem 0.7rem;
		border: 1px dashed var(--line-strong);
		border-radius: 12px;
		background: var(--surface-inset);
	}
	.devtools-head {
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
	}
	.devtools p {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.4;
		color: var(--fg-muted);
	}

	.spinner {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 999px;
		border: 2px solid var(--line-strong);
		border-top-color: var(--brand-deep);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
