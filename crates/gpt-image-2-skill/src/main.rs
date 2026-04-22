fn main() {
    let args: Vec<String> = std::env::args().collect();
    std::process::exit(gpt_image_2_skill::run(&args));
}
