import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-tutorial',
  standalone: true,
  imports: [],
  templateUrl: './tutorial.html',
  styleUrl: './tutorial.scss',
})
export class Tutorial implements OnInit {
  private fromRoute = '/rooms';
  private backQueryParams: Record<string, string> = {};

  constructor(private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const from = this.route.snapshot.queryParamMap.get('from');
    if (from === 'create-room') {
      this.fromRoute = '/create-room';
      const barajas = this.route.snapshot.queryParamMap.get('barajas');
      if (barajas) {
        this.backQueryParams = { barajas };
      }
    } else {
      this.fromRoute = '/rooms';
    }
  }

  goBack(): void {
    this.router.navigate([this.fromRoute], { queryParams: this.backQueryParams });
  }
}
