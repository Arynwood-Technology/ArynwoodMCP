import argparse
import os
import subprocess

# kohya_ss lives outside the repo with its own venv (torch+CUDA+accelerate
# already installed there), same as sad-talker/whisper below.
KOHYA_SS_DIR = "/home/lorelei/tools/kohya_ss"
ACCELERATE = os.path.join(KOHYA_SS_DIR, "venv", "bin", "accelerate")
TRAIN_SCRIPT = os.path.join(KOHYA_SS_DIR, "sd-scripts", "sdxl_train_network.py")


def run_training(
    base_model, train_data_dir, output_dir, output_name, resolution,
    network_dim, network_alpha, train_batch_size, max_train_epochs,
    learning_rate, mixed_precision="bf16",
):
    os.makedirs(output_dir, exist_ok=True)
    cmd = [
        ACCELERATE, "launch",
        "--num_cpu_threads_per_process", "1",
        "--mixed_precision", mixed_precision,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", base_model,
        "--train_data_dir", train_data_dir,
        "--output_dir", output_dir,
        "--output_name", output_name,
        "--resolution", f"{resolution},{resolution}",
        "--network_module", "networks.lora",
        "--network_dim", str(network_dim),
        "--network_alpha", str(network_alpha),
        "--train_batch_size", str(train_batch_size),
        "--max_train_epochs", str(max_train_epochs),
        "--learning_rate", str(learning_rate),
        "--optimizer_type", "AdamW8bit",
        "--mixed_precision", mixed_precision,
        "--gradient_checkpointing",
        "--cache_latents",
        "--sdpa",
        "--save_every_n_epochs", "1",
        "--save_model_as", "safetensors",
        "--enable_bucket",
        # kohya's own --caption_extension default is ".caption", not ".txt" — without this,
        # it silently finds no caption files and trains on the bare folder class token only,
        # ignoring every caption prepare_lora_dataset.py generated.
        "--caption_extension", ".txt",
    ]
    # No output capture: stdout/stderr are inherited straight through to
    # whatever reads *this* process's pipes, so kohya's live tqdm progress
    # isn't buffered or delayed on its way back to the caller.
    subprocess.run(cmd, cwd=KOHYA_SS_DIR, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base_model", required=True)
    parser.add_argument("--train_data_dir", required=True,
                         help="Parent dir containing the {repeats}_{trigger} subfolder")
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--output_name", required=True)
    parser.add_argument("--resolution", type=int, default=1024)
    parser.add_argument("--network_dim", type=int, default=32)
    parser.add_argument("--network_alpha", type=int, default=16)
    parser.add_argument("--train_batch_size", type=int, default=1)
    parser.add_argument("--max_train_epochs", type=int, default=10)
    parser.add_argument("--learning_rate", type=float, default=1e-4)
    parser.add_argument("--mixed_precision", default="bf16", choices=["no", "fp16", "bf16"])
    args = parser.parse_args()

    run_training(
        args.base_model, args.train_data_dir, args.output_dir, args.output_name,
        args.resolution, args.network_dim, args.network_alpha, args.train_batch_size,
        args.max_train_epochs, args.learning_rate, args.mixed_precision,
    )
