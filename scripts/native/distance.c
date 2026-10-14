typedef signed short Distance;
typedef unsigned char Cell;
static Distance input[324];
static Distance output[81];
static Cell queue[81];

__attribute__((visibility("default"))) Distance *input_pointer(void){return input;}
__attribute__((visibility("default"))) Distance *output_pointer(void){return output;}
__attribute__((visibility("default"))) void calculate(int row){
  for(int p=0;p<81;p++)output[p]=-1;
  int head=0,tail=0;
  for(int x=0;x<9;x++){int p=row*9+x;output[p]=0;queue[tail++]=(Cell)p;}
  while(head<tail){
    int p=queue[head++],nextDistance=output[p]+1;
    for(int d=0;d<4;d++){
      int next=input[p*4+d];
      if(next>=0&&output[next]<0){output[next]=(Distance)nextDistance;queue[tail++]=(Cell)next;}
    }
  }
}
